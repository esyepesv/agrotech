import type { FarmContext } from '../../domain/farm/farm-context.js';
import { ANONYMOUS_FARM_CONTEXT } from '../../domain/farm/farm-context.js';
import { channelIdentityValue } from '../../domain/message/channel-identity.js';
import { chatMenuReply, greetingFor } from '../../domain/farm/chat-menu.js';
import { classifySmallTalk } from '../../domain/query/small-talk.js';
import { INTENT_CONFIDENCE_THRESHOLD } from '../../domain/intent/intent.js';
import { parseShortReply } from '../../domain/intent/short-reply.js';
import type {
  IncomingMessage,
  Locale,
  MessageType,
} from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import { renderNumberedFallback } from '../../domain/message/reply-option.js';
import { createQuery } from '../../domain/query/query.js';
import { ChannelDeliveryError } from '../../domain/shared/channel-delivery-error.js';
import type { Result } from '../../domain/shared/result.js';
import type { ChannelError, ChannelGateway } from '../ports/channel-gateway.js';
import type { ConversationLog } from '../ports/conversation-log.js';
import type { FarmRepository } from '../ports/farm-repository.js';
import type { IntentClassifier } from '../ports/intent-classifier.js';
import type { InteractiveGateway } from '../ports/interactive-gateway.js';
import type { PendingEventStore } from '../ports/pending-event-store.js';
import type { SpeechSynthesizer } from '../ports/speech-synthesizer.js';
import type { Transcriber } from '../ports/transcriber.js';
import type { AnswerQuery, ResolvedQuestion } from './answer-query.js';
import { ANSWER_QUERY_MESSAGES } from './answer-query.js';
import type { ConfirmFarmEvent } from './confirm-farm-event.js';
import type { FarmReply } from './farm-reply.js';
import type { LogFarmEvent } from './log-farm-event.js';
import type { OnboardingContext, OnboardingConversation } from './onboarding-conversation.js';
import type { QueryFarmState } from './query-farm-state.js';
import type { LinkChatIdentity } from './link-chat-identity.js';

export interface HandleIncomingMessageDeps {
  readonly answerQuery: AnswerQuery;
  readonly logFarmEvent: LogFarmEvent;
  readonly confirmFarmEvent: ConfirmFarmEvent;
  readonly queryFarmState: QueryFarmState;
  // Tipado estructural (arquitectura-v1.2.md §4): cualquier implementación
  // de OnboardingConversation sirve, el container decide cuál inyectar.
  readonly onboarding: OnboardingConversation;
  readonly intentClassifier: IntentClassifier;
  readonly farmRepository: FarmRepository;
  readonly pendingEventStore: PendingEventStore;
  readonly transcriber: Transcriber;
  readonly synthesizer: SpeechSynthesizer;
  readonly conversationLog: ConversationLog;
  // Mismo hasheo con sal secreta que v1 (D2 de PLAN-v1.1.md); en Corte 1 lo
  // implementa un helper HMAC-SHA256 compartido con USER_ID_SALT.
  readonly hashUserId: (channelUserId: string) => string;
  readonly linkChatIdentity: LinkChatIdentity;
}

const INVITE_REGISTER_MESSAGE =
  'Para llevar tus registros primero creo tu granja. Dime: ¿cómo se llama tu granja?';

const NO_PENDING_MESSAGE = 'No tengo nada pendiente de confirmar. ¿Me repites el registro?';

const UNTRANSCRIBED_PLACEHOLDER = '[voz no transcrita]';

/**
 * Orquestador del router de v1.1 (PLAN-v1.1.md §2): resuelve el texto UNA
 * sola vez (evita doble Whisper, D5), aplica el atajo determinista de
 * confirmación/cancelación, clasifica la intención y despacha al caso de
 * uso farm correspondiente o delega en AnswerQuery (rama por defecto:
 * question/unknown/baja confianza/fallo del clasificador nunca dejan a v1
 * peor de lo que ya estaba, R1/R2).
 */
export class HandleIncomingMessage {
  constructor(private readonly deps: HandleIncomingMessageDeps) {}

  async handle(message: IncomingMessage, gateway: ChannelGateway): Promise<void> {
    const startedAt = Date.now();
    void gateway.indicateTyping(message);

    const resolved = await this.resolveText(message, gateway);
    if (resolved === undefined) {
      const delivery = await this.sendText(gateway, message, ANSWER_QUERY_MESSAGES.sttFailed);
      await this.record(
        message,
        UNTRANSCRIBED_PLACEHOLDER,
        ANSWER_QUERY_MESSAGES.sttFailed,
        startedAt,
      );
      this.throwIfDeliveryFailed(message, delivery);
      return;
    }

    const userHash = this.deps.hashUserId(
      channelIdentityValue(message.channel, message.channelUserId),
    );
    const operatorWithFarm = await this.deps.farmRepository.findOperatorByHash(userHash);
    // El pending de un operario vive bajo su OperatorId; el de un usuario
    // aún no registrado (alta de granja en curso), bajo el hash del canal.
    const pendingKey = operatorWithFarm ? operatorWithFarm.operator.id : userHash;
    const hasPending = await this.deps.pendingEventStore.hasPending(pendingKey);
    // El borrador de registro (spec 001) vive SIEMPRE bajo el hash del canal,
    // incluso para un dueño ya registrado que da de alta otra finca. Se
    // consulta aparte cuando la llave del operario es distinta: si no, su
    // "sí" de confirmación caería en ConfirmFarmEvent, que consumiría el
    // borrador y perdería el registro a medio hacer.
    const hasOnboardingPending = operatorWithFarm
      ? await this.deps.pendingEventStore.hasPending(userHash)
      : hasPending;

    if (operatorWithFarm === null && !hasOnboardingPending) {
      const phone = this.detectPhone(message);
      if (phone !== undefined) {
        const user = await this.deps.farmRepository.findUserByPhoneHash(this.deps.hashUserId(phone));
        if (user !== null) {
          const linked = await this.deps.linkChatIdentity.tryLink(
            message.channel,
            message.channelUserId,
            phone,
          );
          if (linked !== null) {
            await this.deliverReply(message, gateway, resolved, { text: greetingFor(user.displayName) }, startedAt);
            return;
          }
        }
      }

      if (resolved.question === 'menu:register') {
        const reply = await this.deps.onboarding.handle(userHash, resolved.question, this.onboardingContext(message));
        await this.deliverReply(message, gateway, resolved, reply, startedAt);
        return;
      }
      if (resolved.question === 'menu:login') {
        const reply: FarmReply = message.channel === 'telegram'
          ? { text: 'Comparte tu número para encontrar tu cuenta.', requestContact: true }
          : { text: 'No encontramos una cuenta con este número. Puedes registrarte o escribirnos para ayudarte.' };
        await this.deliverReply(message, gateway, resolved, reply, startedAt);
        return;
      }
      if (classifySmallTalk(resolved.question) === 'greeting') {
        await this.deliverReply(message, gateway, resolved, chatMenuReply(), startedAt);
        return;
      }
    }

    // El contacto propio compartido por Telegram es una respuesta verificada
    // al paso de celular. Tiene prioridad sobre el clasificador para que no
    // acabe como una consulta de conocimiento.
    if (hasOnboardingPending && message.contactPhone !== undefined) {
      const reply = await this.deps.onboarding.handle(
        userHash,
        resolved.question,
        this.onboardingContext(message),
      );
      await this.deliverReply(message, gateway, resolved, reply, startedAt);
      return;
    }

    // Un saludo no debe llevar un borrador conversacional al clasificador ni
    // contarse como un intento fallido. En su lugar, se repite exactamente el
    // paso pendiente para que Telegram vuelva a mostrar sus botones.
    if (hasOnboardingPending && classifySmallTalk(resolved.question) === 'greeting') {
      const reply = await this.deps.onboarding.resume(userHash, this.onboardingContext(message));
      if (reply !== null) {
        await this.deliverReply(message, gateway, resolved, reply, startedAt);
        return;
      }
    }

    // Atajo determinista ANTES del clasificador (PLAN-v1.1.md §2): un "sí"
    // o "no" corto con pending activo no necesita pasar por el LLM. Un
    // registro en curso tiene prioridad sobre cualquier otro pendiente.
    const shortReply = parseShortReply(resolved.question);
    if (shortReply !== undefined && (hasPending || hasOnboardingPending)) {
      let reply: FarmReply;
      if (hasOnboardingPending) {
        reply = await this.deps.onboarding.handle(
          userHash,
          resolved.question,
          this.onboardingContext(message),
        );
      } else if (operatorWithFarm) {
        reply = await this.deps.confirmFarmEvent.handle(
          shortReply,
          operatorWithFarm.operator,
          operatorWithFarm.farm,
        );
      } else {
        reply = await this.deps.confirmFarmEvent.handleAnonymous(shortReply, userHash);
      }
      await this.deliverReply(message, gateway, resolved, reply, startedAt);
      return;
    }

    const ctx: FarmContext = operatorWithFarm
      ? {
          farmId: operatorWithFarm.farm.id,
          operatorId: operatorWithFarm.operator.id,
          // Corte 0: itemNames/chapetas/activeLotCount se enriquecen en
          // cortes futuros (requieren listar inventario/sows/lots reales).
          itemNames: [],
          chapetas: [],
          activeLotCount: 0,
          hasPending,
        }
      : ANONYMOUS_FARM_CONTEXT;

    const classified = await this.deps.intentClassifier.classify(resolved.question, ctx);
    if (!classified.ok) {
      // Fallo del clasificador → rama por defecto v1 (R1): nunca deja peor.
      await this.deps.answerQuery.handleResolved(message, gateway, resolved);
      return;
    }

    const intent = classified.value;
    if (
      intent.confidence < INTENT_CONFIDENCE_THRESHOLD ||
      intent.kind === 'question' ||
      intent.kind === 'unknown'
    ) {
      await this.deps.answerQuery.handleResolved(message, gateway, resolved);
      return;
    }

    switch (intent.kind) {
      case 'log_event': {
        const reply: FarmReply = operatorWithFarm
          ? await this.deps.logFarmEvent.handle(
              operatorWithFarm.operator.id,
              resolved.question,
              ctx,
              message.type === 'voice' ? 'voice' : 'text',
            )
          : { text: INVITE_REGISTER_MESSAGE };
        await this.deliverReply(message, gateway, resolved, reply, startedAt);
        return;
      }
      case 'query_state': {
        const reply: FarmReply = operatorWithFarm
          ? await this.deps.queryFarmState.handle(operatorWithFarm.farm.id, resolved.question)
          : { text: INVITE_REGISTER_MESSAGE };
        await this.deliverReply(message, gateway, resolved, reply, startedAt);
        return;
      }
      case 'onboarding': {
        const reply = await this.deps.onboarding.handle(
          userHash,
          resolved.question,
          this.onboardingContext(message),
        );
        await this.deliverReply(message, gateway, resolved, reply, startedAt);
        return;
      }
      case 'confirm':
      case 'cancel': {
        let reply: FarmReply;
        if (hasOnboardingPending) {
          reply = await this.deps.onboarding.handle(
            userHash,
            resolved.question,
            this.onboardingContext(message),
          );
        } else if (!hasPending) {
          reply = { text: NO_PENDING_MESSAGE };
        } else if (operatorWithFarm) {
          reply = await this.deps.confirmFarmEvent.handle(
            intent.kind,
            operatorWithFarm.operator,
            operatorWithFarm.farm,
          );
        } else {
          reply = await this.deps.confirmFarmEvent.handleAnonymous(intent.kind, userHash);
        }
        await this.deliverReply(message, gateway, resolved, reply, startedAt);
        return;
      }
    }
  }

  /** Lo que solo el adaptador de entrada sabe del canal (spec 001 §4.1.2). */
  private onboardingContext(message: IncomingMessage): OnboardingContext {
    return {
      channel: message.channel,
      channelUserId: message.channelUserId,
      detectedPhone: this.detectPhone(message),
      inputWasVoice: message.type === 'voice',
    };
  }

  private async resolveText(
    message: IncomingMessage,
    gateway: ChannelGateway,
  ): Promise<ResolvedQuestion | undefined> {
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

  /** Entrega la respuesta de un caso de uso farm y registra el turno (v1 lo hace dentro de AnswerQuery). */
  private async deliverReply(
    incoming: IncomingMessage,
    gateway: ChannelGateway,
    resolved: ResolvedQuestion,
    reply: FarmReply,
    startedAt: number,
  ): Promise<void> {
    // En texto, el mensaje interactivo ya contiene el cuerpo de la pregunta:
    // enviarlo además como texto normal duplicaba cada paso en Telegram. En
    // voz sí se conserva la nota de audio y luego el teclado como segundo
    // mensaje, porque Telegram no puede adjuntar botones a una nota de voz.
    const hasInteractiveControl =
      reply.requestContact === true || (reply.options !== undefined && reply.options.length > 0);
    const delivery = incoming.type === 'text' && hasInteractiveControl
      ? await this.deliverInteractiveReply(gateway, incoming, reply)
      : await this.deliver(gateway, incoming, reply.text, resolved.locale);
    if (incoming.type === 'voice' && hasInteractiveControl) {
      await this.deliverInteractiveReply(gateway, incoming, reply);
    }
    await this.record(incoming, resolved.question, reply.text, startedAt);
    this.throwIfDeliveryFailed(incoming, delivery);
  }

  /** Regla de formato v1 (§2): voz → voz con fallback a texto si el TTS falla; texto → texto. */
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
    }
    return this.sendText(gateway, incoming, text);
  }

  /**
   * Opciones cerradas (spec 001 §4.1.1) y `requestContact` (§4.1.2): best
   * effort, nunca bloquea el flujo. Si el gateway no implementa
   * `InteractiveGateway`, no soporta interactivos, o el envío falla, degrada
   * a texto con `renderNumberedFallback` (§5, "fallo al enviar el mensaje
   * interactivo").
   */
  private async deliverInteractiveReply(
    gateway: ChannelGateway,
    incoming: IncomingMessage,
    reply: FarmReply,
  ): Promise<Result<void, ChannelError>> {
    const interactive = asInteractiveGateway(gateway);

    if (reply.requestContact === true && interactive?.requestContact !== undefined) {
      const requested = await interactive.requestContact(incoming.channelUserId, reply.text);
      if (requested.ok) {
        return requested;
      }
      // Si pedir el contacto falla, la persona aún puede escribir el número
      // a mano (fallback del mismo paso).
      return this.sendText(gateway, incoming, reply.text);
    }

    if (reply.options === undefined || reply.options.length === 0) {
      return this.sendText(gateway, incoming, reply.text);
    }

    if (interactive !== undefined && interactive.supportsInteractive()) {
      const sent = await interactive.sendInteractive({
        channel: incoming.channel,
        channelUserId: incoming.channelUserId,
        body: reply.text,
        options: reply.options,
        layout: reply.layout ?? 'buttons',
      });
      if (sent.ok) {
        return sent;
      }
    }

    return this.sendText(gateway, incoming, renderNumberedFallback(reply.text, reply.options));
  }

  /**
   * Detección del celular por canal (spec 001 §4.1.2): WhatsApp siempre
   * (channelUserId ES el celular); Telegram solo si el webhook ya resolvió
   * un contacto compartido en ESTE mensaje.
   */
  private detectPhone(message: IncomingMessage): string | undefined {
    if (message.channel === 'whatsapp') {
      // channelIdentityValue normaliza a E.164 si es un celular colombiano
      // reconocible; si no, devuelve el id crudo, que nunca empieza por "+"
      // (un E.164 colombiano siempre lo hace) — así el "no reconocible" del
      // helper compartido se traduce aquí en "no lo detectamos como celular".
      const normalized = channelIdentityValue('whatsapp', message.channelUserId);
      return normalized.startsWith('+') ? normalized : undefined;
    }
    return message.contactPhone;
  }

  private async sendText(
    gateway: ChannelGateway,
    incoming: IncomingMessage,
    text: string,
  ): Promise<Result<void, ChannelError>> {
    return gateway.send(this.outgoing(incoming, 'text', text));
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

  private throwIfDeliveryFailed(
    incoming: IncomingMessage,
    delivery: Result<void, ChannelError>,
  ): void {
    if (!delivery.ok) {
      throw new ChannelDeliveryError(incoming.channel, delivery.error.message);
    }
  }

  private async record(
    message: IncomingMessage,
    questionText: string,
    answerText: string,
    startedAt: number,
  ): Promise<void> {
    await this.deps.conversationLog.record({
      channel: message.channel,
      channelUserId: message.channelUserId,
      questionText,
      answerText,
      // Las ramas farm son administrativas (no pasan por SafetyPolicy de
      // v1); 'answer' es el valor neutro de ConversationTurn.action.
      action: 'answer',
      latencyMs: Date.now() - startedAt,
      createdAt: new Date(),
    });
  }
}

export const HANDLE_INCOMING_MESSAGE_MESSAGES = {
  inviteRegister: INVITE_REGISTER_MESSAGE,
  noPending: NO_PENDING_MESSAGE,
} as const;

/**
 * `InteractiveGateway` es un puerto separado de `ChannelGateway` (ISP,
 * arquitectura-v1.2.md §6): un gateway puede implementarlo además del
 * contrato de v1 sin que `ChannelGateway` lo declare. Duck-typing en
 * runtime es la forma de "preguntarle" al gateway resuelto si lo soporta.
 */
function asInteractiveGateway(gateway: ChannelGateway): InteractiveGateway | undefined {
  const candidate = gateway as Partial<InteractiveGateway>;
  return typeof candidate.supportsInteractive === 'function' &&
    typeof candidate.sendInteractive === 'function'
    ? (gateway as unknown as InteractiveGateway)
    : undefined;
}
