import type { IncomingMessage, Locale, MessageType } from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import type { KnowledgeReference } from '../../domain/knowledge/retrieved-chunk.js';
import { toReference } from '../../domain/knowledge/retrieved-chunk.js';
import { createQuery } from '../../domain/query/query.js';
import type { SafetyAction } from '../../domain/safety/safety-decision.js';
import type { AnswerGenerator } from '../ports/answer-generator.js';
import type { ChannelGateway } from '../ports/channel-gateway.js';
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
    const resolved = await this.resolveQuestion(message, gateway);

    if (resolved === undefined) {
      await this.sendText(gateway, message, STT_FAILED_MESSAGE);
      await this.record(message, UNTRANSCRIBED_PLACEHOLDER, STT_FAILED_MESSAGE, 'refuse', startedAt);
      return;
    }

    const { question, locale } = resolved;
    const decision = this.deps.safetyPolicy.assessQuestion(question);

    if (decision.action !== 'answer') {
      const text = decision.action === 'escalate_vet' ? ESCALATION_MESSAGE : REFUSAL_MESSAGE;
      await this.deliver(gateway, message, text, locale);
      await this.record(message, question, text, decision.action, startedAt);
      return;
    }

    const answer = await this.generateGroundedAnswer(question, locale);
    await this.deliver(gateway, message, answer.text, locale);
    await this.record(message, question, answer.text, 'answer', startedAt);
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
    const context = await this.deps.retriever.retrieve(question, RETRIEVAL_K);

    // Grounding obligatorio: sin contexto del corpus curado no se responde.
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
  ): Promise<void> {
    if (incoming.type === 'voice') {
      const audio = await this.deps.synthesizer.synthesize(text, { locale });
      if (audio.ok) {
        await gateway.send(this.outgoing(incoming, 'voice', text, audio.value));
        return;
      }
      // Degradación elegante: si TTS falla, la respuesta sale en texto.
    }
    await this.sendText(gateway, incoming, text);
  }

  private async sendText(
    gateway: ChannelGateway,
    incoming: IncomingMessage,
    text: string,
  ): Promise<void> {
    await gateway.send(this.outgoing(incoming, 'text', text));
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
