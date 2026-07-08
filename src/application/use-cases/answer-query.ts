import type {
  IncomingMessage,
  Locale,
  MessageType,
} from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import type { KnowledgeReference } from '../../domain/knowledge/retrieved-chunk.js';
import { toReference } from '../../domain/knowledge/retrieved-chunk.js';
import { createQuery } from '../../domain/query/query.js';
import type { SafetyAction } from '../../domain/safety/safety-decision.js';
import { ChannelDeliveryError } from '../../domain/shared/channel-delivery-error.js';
import type { Result } from '../../domain/shared/result.js';
import type { AnswerGenerator } from '../ports/answer-generator.js';
import type { ChannelError, ChannelGateway } from '../ports/channel-gateway.js';
import type { ConversationLog } from '../ports/conversation-log.js';
import type { KnowledgeRetriever } from '../ports/knowledge-retriever.js';
import type { SafetyPolicy } from '../ports/safety-policy.js';
import type { SpeechSynthesizer } from '../ports/speech-synthesizer.js';
import type { Transcriber } from '../ports/transcriber.js';

export interface AnswerQueryDeps {
  readonly transcriber: Transcriber;
  readonly synthesizer: SpeechSynthesizer;
  readonly retriever: KnowledgeRetriever;
  readonly generator: AnswerGenerator;
  readonly safetyPolicy: SafetyPolicy;
  readonly conversationLog: ConversationLog;
  /**
   * Umbral mínimo de similitud (#3 hardening) para aceptar un chunk
   * recuperado como contexto válido: por debajo de este score, el chunk se
   * descarta del grounding aunque haya quedado en el top-k por distancia.
   */
  readonly minRelevanceScore: number;
}

const RETRIEVAL_K = 5;
const DEFAULT_LOCALE: Locale = 'es-CO';

const ESCALATION_MESSAGE =
  'Este tema involucra salud animal o medicación, y ahí no me corresponde darte una recomendación. ' +
  'Por favor consulta a un veterinario o técnico de confianza: una decisión equivocada puede costarte ' +
  'una hembra o una camada. Soy un apoyo de manejo general, no un reemplazo del veterinario.';

const REFUSAL_MESSAGE =
  'Esa consulta está fuera de mi alcance. Puedo ayudarte con manejo reproductivo general, ' +
  'alimentación, condición corporal y prácticas de crianza porcina.';

const NO_KNOWLEDGE_MESSAGE =
  'No tengo información confiable para responderte eso con seguridad. ' +
  'Te sugiero consultar a un técnico o zootecnista de confianza.';

const STT_FAILED_MESSAGE =
  'No pude entender la nota de voz. ¿Puedes reenviarla o escribir tu pregunta en texto?';

const UNTRANSCRIBED_PLACEHOLDER = '[voz no transcrita]';

/**
 * Orquesta el flujo de la sección 5: canal → transcripción → guardrails →
 * RAG → generación → síntesis → respuesta. Regla de formato: input voz →
 * respuesta voz (con fallback a texto si TTS falla); input texto → texto.
 */
export class AnswerQuery {
  constructor(private readonly deps: AnswerQueryDeps) {}

  async handle(message: IncomingMessage, gateway: ChannelGateway): Promise<void> {
    const startedAt = Date.now();
    // Feedback inmediato "escribiendo…" (best-effort, en paralelo: no añade latencia).
    void gateway.indicateTyping(message);
    const resolved = await this.resolveQuestion(message, gateway);

    if (resolved === undefined) {
      const delivery = await this.sendText(gateway, message, STT_FAILED_MESSAGE);
      await this.record(
        message,
        UNTRANSCRIBED_PLACEHOLDER,
        STT_FAILED_MESSAGE,
        'refuse',
        startedAt,
      );
      this.throwIfDeliveryFailed(message, delivery);
      return;
    }

    const { question, locale } = resolved;
    const decision = this.deps.safetyPolicy.assessQuestion(question);

    if (decision.action !== 'answer') {
      const text = decision.action === 'escalate_vet' ? ESCALATION_MESSAGE : REFUSAL_MESSAGE;
      const delivery = await this.deliver(gateway, message, text, locale);
      await this.record(message, question, text, decision.action, startedAt);
      this.throwIfDeliveryFailed(message, delivery);
      return;
    }

    // Refresca el "escribiendo…" antes de la generación (en Telegram dura ~5 s;
    // en WhatsApp la ventana de 25 s hace de esto un refresco inofensivo).
    void gateway.indicateTyping(message);
    const answer = await this.generateGroundedAnswer(question, locale);
    const reviewed = this.applyOutputGuardrail(question, answer.text);
    const delivery = await this.deliver(gateway, message, reviewed.text, locale);
    await this.record(message, question, reviewed.text, reviewed.action, startedAt);
    this.throwIfDeliveryFailed(message, delivery);
  }

  /**
   * Guardrail post-generación (#4, cablea SafetyPolicy.reviewAnswer): revisa
   * el borrador ya redactado por el LLM (que pudo colarse con contenido de
   * medicación/dosis pese a que la pregunta original haya sido permitida) y,
   * si la decisión no es 'answer', sustituye el texto a entregar por el
   * mensaje de escalamiento/rechazo correspondiente.
   */
  private applyOutputGuardrail(
    question: string,
    draft: string,
  ): { text: string; action: SafetyAction } {
    const review = this.deps.safetyPolicy.reviewAnswer(question, draft);
    if (review.action === 'answer') {
      return { text: draft, action: 'answer' };
    }
    const text = review.action === 'escalate_vet' ? ESCALATION_MESSAGE : REFUSAL_MESSAGE;
    return { text, action: review.action };
  }

  private async resolveQuestion(
    message: IncomingMessage,
    gateway: ChannelGateway,
  ): Promise<{ question: string; locale: Locale } | undefined> {
    if (message.type === 'text') {
      const query = createQuery(message.text ?? '');
      return query.text.length > 0 ? { question: query.text, locale: query.locale } : undefined;
    }

    if (message.audioRef === undefined) {
      return undefined;
    }

    const audio = await gateway.fetchAudio(message.audioRef);
    if (!audio.ok) {
      return undefined;
    }

    const transcript = await this.deps.transcriber.transcribe(audio.value);
    if (!transcript.ok || transcript.value.text.trim().length === 0) {
      return undefined;
    }

    const query = createQuery(transcript.value.text, transcript.value.language);
    return { question: query.text, locale: query.locale };
  }

  private async generateGroundedAnswer(
    question: string,
    locale: Locale,
  ): Promise<{ text: string; sources: readonly KnowledgeReference[] }> {
    const retrieved = await this.deps.retriever.retrieve(question, RETRIEVAL_K);

    // Umbral de relevancia (#3 hardening): el retriever devuelve el top-k
    // por distancia aunque la similitud sea baja; se descartan los chunks
    // que no llegan al umbral ANTES de decidir si hay grounding suficiente.
    const context = retrieved.filter((chunk) => chunk.score >= this.deps.minRelevanceScore);

    // Grounding obligatorio: sin contexto relevante del corpus curado no se responde.
    if (context.length === 0) {
      return { text: NO_KNOWLEDGE_MESSAGE, sources: [] };
    }

    const generated = await this.deps.generator.generate({ question, context, locale });
    if (!generated.ok || generated.value.text.trim().length === 0) {
      return { text: NO_KNOWLEDGE_MESSAGE, sources: context.map(toReference) };
    }

    return { text: generated.value.text, sources: generated.value.usedSources };
  }

  private async deliver(
    gateway: ChannelGateway,
    incoming: IncomingMessage,
    text: string,
    locale: Locale,
  ): Promise<Result<void, ChannelError>> {
    if (incoming.type === 'voice') {
      const audio = await this.deps.synthesizer.synthesize(text, { locale });
      if (audio.ok) {
        return gateway.send(this.outgoing(incoming, 'voice', text, audio.value));
      }
      // Degradación elegante: si TTS falla, la respuesta sale en texto.
    }
    return this.sendText(gateway, incoming, text);
  }

  private async sendText(
    gateway: ChannelGateway,
    incoming: IncomingMessage,
    text: string,
  ): Promise<Result<void, ChannelError>> {
    return gateway.send(this.outgoing(incoming, 'text', text));
  }

  /**
   * El envío real (texto o voz) es el único punto que puede fallar de forma
   * NO silenciosa: si gateway.send(...) devuelve err (p. ej. token de
   * WhatsApp expirado), el turno ya quedó registrado como métrica, pero
   * handle() debe rechazar para que el `.catch` del dispatcher/runtime
   * (sección 14) lo loguee con messageId y channel en vez de tragárselo.
   */
  private throwIfDeliveryFailed(
    incoming: IncomingMessage,
    delivery: Result<void, ChannelError>,
  ): void {
    if (!delivery.ok) {
      throw new ChannelDeliveryError(incoming.channel, delivery.error.message);
    }
  }

  private outgoing(
    incoming: IncomingMessage,
    type: MessageType,
    text: string,
    audio?: OutgoingMessage['audio'],
  ): OutgoingMessage {
    return {
      channel: incoming.channel,
      channelUserId: incoming.channelUserId,
      type,
      text,
      ...(audio === undefined ? {} : { audio }),
    };
  }

  private async record(
    message: IncomingMessage,
    questionText: string,
    answerText: string,
    action: SafetyAction,
    startedAt: number,
  ): Promise<void> {
    await this.deps.conversationLog.record({
      channel: message.channel,
      channelUserId: message.channelUserId,
      questionText,
      answerText,
      action,
      latencyMs: Date.now() - startedAt,
      createdAt: new Date(),
    });
  }
}

export const ANSWER_QUERY_MESSAGES = {
  escalation: ESCALATION_MESSAGE,
  refusal: REFUSAL_MESSAGE,
  noKnowledge: NO_KNOWLEDGE_MESSAGE,
  sttFailed: STT_FAILED_MESSAGE,
  defaultLocale: DEFAULT_LOCALE,
} as const;
