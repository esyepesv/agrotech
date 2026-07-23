import { describe, expect, it } from 'vitest';
import type { Farm } from '../../src/domain/farm/farm.js';
import type { FarmEventDraft, FeedDelivery } from '../../src/domain/farm/farm-event.js';
import type { Operator } from '../../src/domain/farm/operator.js';
import { channelIdentityValue } from '../../src/domain/message/channel-identity.js';
import type { IncomingMessage } from '../../src/domain/message/incoming-message.js';
import type { InteractiveGateway } from '../../src/application/ports/interactive-gateway.js';
import type { InteractiveMessage } from '../../src/domain/message/reply-option.js';
import { ok } from '../../src/domain/shared/result.js';
import { AnswerQuery } from '../../src/application/use-cases/answer-query.js';
import { ConfirmFarmEvent } from '../../src/application/use-cases/confirm-farm-event.js';
import {
  HANDLE_INCOMING_MESSAGE_MESSAGES,
  HandleIncomingMessage,
} from '../../src/application/use-cases/handle-incoming-message.js';
import { LogFarmEvent } from '../../src/application/use-cases/log-farm-event.js';
import { LinkChatIdentity } from '../../src/application/use-cases/link-chat-identity.js';
import { QueryFarmState } from '../../src/application/use-cases/query-farm-state.js';
import { ApproveWorker } from '../../src/application/use-cases/approve-worker.js';
import { RegisterFarmAndUser } from '../../src/application/use-cases/register-farm-and-user.js';
import { RegisterFarmAndUserConversation } from '../../src/application/use-cases/register-farm-and-user-conversation.js';
import { FakeAnswerGenerator } from './fakes/fake-answer-generator.js';
import { FakeChannelGateway } from './fakes/fake-channel-gateway.js';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeConversationLog } from './fakes/fake-conversation-log.js';
import { FakeEventExtractor } from './fakes/fake-event-extractor.js';
import { FakeEventSafetyPolicy } from './fakes/fake-event-safety-policy.js';
import { FakeFarmEventStore } from './fakes/fake-farm-event-store.js';
import { FakeFarmRepository } from './fakes/fake-farm-repository.js';
import { FakeIntentClassifier } from './fakes/fake-intent-classifier.js';
import { FakeInventoryRepository } from './fakes/fake-inventory-repository.js';
import { FakeKnowledgeRetriever } from './fakes/fake-knowledge-retriever.js';
import { FakeLotRepository } from './fakes/fake-lot-repository.js';
import { FakePendingEventStore } from './fakes/fake-pending-event-store.js';
import { FakeSafetyPolicy } from './fakes/fake-safety-policy.js';
import { FakeSowRepository } from './fakes/fake-sow-repository.js';
import { FakeSpeechSynthesizer } from './fakes/fake-speech-synthesizer.js';
import { FakeTranscriber } from './fakes/fake-transcriber.js';

const MIN_RELEVANCE_SCORE = 0.35;
const GENERATOR_ANSWER = 'Aliméntala a voluntad durante la lactancia, repartido en 2 o 3 comidas.';
const HASH_PREFIX = 'hash-';
const FARM_ID = 'farm-1';

class FakeInteractiveChannelGateway extends FakeChannelGateway implements InteractiveGateway {
  readonly interactiveSent: InteractiveMessage[] = [];
  readonly contactRequests: { channelUserId: string; body: string }[] = [];

  supportsInteractive(): boolean {
    return true;
  }

  async sendInteractive(message: InteractiveMessage) {
    this.interactiveSent.push(message);
    return ok(undefined);
  }

  async requestContact(channelUserId: string, body: string) {
    this.contactRequests.push({ channelUserId, body });
    return ok(undefined);
  }
}

function hashUserId(channelUserId: string): string {
  return `${HASH_PREFIX}${channelUserId}`;
}

// Los fixtures por defecto de este archivo usan channel: 'telegram' — el
// hash de identidad de chat que calcula HandleIncomingMessage pasa SIEMPRE
// por channelIdentityValue (Tarea 1: normalización antes de hashear), que
// para Telegram antepone 'tg:' (espacio propio, nunca colisiona con un
// celular). Este helper reproduce esa misma cadena para que los fixtures de
// operador/pending queden en el hash que el orquestador realmente usa.
function chatHash(channel: 'telegram' | 'whatsapp', channelUserId: string): string {
  return hashUserId(channelIdentityValue(channel, channelUserId));
}

const OPERATOR_HASH = chatHash('telegram', 'user-1');

function textMessage(text: string, channelUserId = 'user-1'): IncomingMessage {
  return {
    channel: 'telegram',
    channelUserId,
    messageId: 'msg-1',
    type: 'text',
    text,
    receivedAt: new Date(),
  };
}

function voiceMessage(channelUserId = 'user-1'): IncomingMessage {
  return {
    channel: 'telegram',
    channelUserId,
    messageId: 'msg-2',
    type: 'voice',
    audioRef: { channel: 'telegram', mediaId: 'file-abc' },
    receivedAt: new Date(),
  };
}

function buildFarm(): Farm {
  return {
    id: FARM_ID,
    name: 'La Esperanza',
    config: { metaPartosPorAno: 2.5, region: 'CO' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function buildOperator(): Operator {
  return {
    id: 'operator-1',
    userId: 'user-1',
    farmId: FARM_ID,
    channelUserHash: OPERATOR_HASH,
    role: 'trabajador',
    status: 'activo',
  };
}

function feedDeliveryDraft(camposFaltantes: string[] = []): FarmEventDraft {
  const payload: FeedDelivery = {
    type: 'feed_delivery',
    itemName: 'Solla',
    qty: camposFaltantes.includes('qty') ? 0 : 3,
    unit: 'bulto',
    targetKind: 'general',
  };
  return {
    payload,
    confidence: 0.9,
    camposFaltantes,
    rawTranscript: 'draft de prueba',
    source: 'text',
  };
}

let idCounter = 0;
function idGenerator(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

function buildHarness(gateway: FakeChannelGateway = new FakeChannelGateway()) {
  const clock = new FakeClock();
  const farmRepository = new FakeFarmRepository();
  const inventoryRepository = new FakeInventoryRepository();
  const sowRepository = new FakeSowRepository();
  const lotRepository = new FakeLotRepository();
  const farmEventStore = new FakeFarmEventStore();
  const pendingEventStore = new FakePendingEventStore(clock);
  const eventSafetyPolicy = new FakeEventSafetyPolicy();
  const eventExtractor = new FakeEventExtractor();
  const intentClassifier = new FakeIntentClassifier();
  const conversationLog = new FakeConversationLog();
  const transcriber = new FakeTranscriber();
  const synthesizer = new FakeSpeechSynthesizer();

  const answerQuery = new AnswerQuery({
    transcriber,
    synthesizer,
    retriever: new FakeKnowledgeRetriever(),
    generator: new FakeAnswerGenerator(),
    safetyPolicy: new FakeSafetyPolicy(['antibiótico', 'dosis']),
    conversationLog,
    minRelevanceScore: MIN_RELEVANCE_SCORE,
  });

  const logFarmEvent = new LogFarmEvent({
    eventExtractor,
    eventSafetyPolicy,
    pendingEventStore,
    clock,
  });

  const confirmFarmEvent = new ConfirmFarmEvent({
    pendingEventStore,
    farmEventStore,
    inventoryRepository,
    sowRepository,
    lotRepository,
    farmRepository,
    clock,
    idGenerator,
  });

  const queryFarmState = new QueryFarmState({ inventoryRepository, farmEventStore, clock });

  const onboarding = new RegisterFarmAndUserConversation({
    registerFarmAndUser: new RegisterFarmAndUser({
      farmRepository,
      clock,
      idGenerator,
      hashUserId,
    }),
    approveWorker: new ApproveWorker({ farmRepository, clock }),
    farmRepository,
    pendingEventStore,
    clock,
  });

  const handler = new HandleIncomingMessage({
    answerQuery,
    logFarmEvent,
    confirmFarmEvent,
    queryFarmState,
    onboarding,
    intentClassifier,
    farmRepository,
    pendingEventStore,
    transcriber,
    synthesizer,
    conversationLog,
    hashUserId,
    linkChatIdentity: new LinkChatIdentity({ farmRepository, hashUserId, clock }),
  });

  return {
    handler,
    gateway,
    clock,
    farmRepository,
    inventoryRepository,
    farmEventStore,
    pendingEventStore,
    eventExtractor,
    intentClassifier,
    conversationLog,
    transcriber,
  };
}

function seedOperator(h: ReturnType<typeof buildHarness>): void {
  h.farmRepository.seedOperator(buildFarm(), buildOperator());
}

function seedSolla(h: ReturnType<typeof buildHarness>, qty = 20): void {
  h.inventoryRepository.seedItem({
    id: 'item-solla',
    farmId: FARM_ID,
    kind: 'concentrado',
    name: 'Solla',
    unit: 'bulto',
    currentQty: qty,
    avgUnitCost: 5000,
  });
}

describe('HandleIncomingMessage', () => {
  it('saluda con menú a un chat desconocido', async () => {
    const h = buildHarness();

    await h.handler.handle(textMessage('hola'), h.gateway);

    expect(h.gateway.sent).toHaveLength(1);
    expect(h.gateway.sent[0]?.text).toContain('¿En qué te puedo ayudar?');
    expect(h.gateway.sent[0]?.text).toContain('1. Registrarme');
  });

  it('pregunta de conocimiento → responde vía AnswerQuery', async () => {
    const h = buildHarness();

    await h.handler.handle(textMessage('¿cómo alimento una hembra lactante?'), h.gateway);

    expect(h.gateway.sent).toHaveLength(1);
    expect(h.gateway.sent[0]?.text).toBe(GENERATOR_ANSWER);
    expect(h.eventExtractor.calls).toHaveLength(0);
  });

  it('log_event con operador registrado → guarda pending y pregunta "¿Confirmo?"; nada en el ledger aún', async () => {
    const h = buildHarness();
    seedOperator(h);
    const text = 'le di 3 bultos de concentrado a la ceba';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });
    h.eventExtractor.respuestas.set(text, feedDeliveryDraft());

    await h.handler.handle(textMessage(text), h.gateway);

    expect(h.gateway.sent[0]?.text).toContain('¿Confirmo?');
    expect(h.farmEventStore.events).toHaveLength(0);
    expect(await h.pendingEventStore.hasPending('operator-1')).toBe(true);
  });

  it('"sí" con pending → append al ledger + descuenta inventario + responde con saldo', async () => {
    const h = buildHarness();
    seedOperator(h);
    seedSolla(h, 20);
    const text = 'le di 3 bultos de concentrado a la ceba';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });
    h.eventExtractor.respuestas.set(text, feedDeliveryDraft());
    await h.handler.handle(textMessage(text), h.gateway);

    await h.handler.handle(textMessage('sí'), h.gateway);

    expect(h.farmEventStore.events).toHaveLength(1);
    expect(h.farmEventStore.events[0]?.payload.type).toBe('feed_delivery');
    expect(h.gateway.sent[1]?.text).toBe('Listo. Te quedan 17 bulto de Solla.');
  });

  it('"no" con pending → descarta; el ledger queda vacío', async () => {
    const h = buildHarness();
    seedOperator(h);
    seedSolla(h, 20);
    const text = 'le di 3 bultos de concentrado a la ceba';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });
    h.eventExtractor.respuestas.set(text, feedDeliveryDraft());
    await h.handler.handle(textMessage(text), h.gateway);

    await h.handler.handle(textMessage('no'), h.gateway);

    expect(h.farmEventStore.events).toHaveLength(0);
    expect(h.gateway.sent[1]?.text).toBe('Listo, lo descarté. No registré nada.');
  });

  it('campos faltantes → pregunta por ellos y guarda el pending parcial', async () => {
    const h = buildHarness();
    seedOperator(h);
    const text = 'llevé concentrado a la ceba';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });
    h.eventExtractor.respuestas.set(text, feedDeliveryDraft(['qty']));

    await h.handler.handle(textMessage(text), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe('Me falta saber: qty. ¿Me lo dices?');
    expect(await h.pendingEventStore.hasPending('operator-1')).toBe(true);
    expect(h.farmEventStore.events).toHaveLength(0);
  });

  it('query_state "¿cuánto me queda?" → lista el inventario', async () => {
    const h = buildHarness();
    seedOperator(h);
    seedSolla(h, 20);
    const text = '¿cuánto me queda de concentrado?';
    h.intentClassifier.respuestas.set(text, { kind: 'query_state', confidence: 0.9 });

    await h.handler.handle(textMessage(text), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe('Te quedan: 20 bulto de Solla.');
  });

  it('usuario desconocido + log_event → invitación a registrar granja; nada persiste', async () => {
    const h = buildHarness();
    const text = 'compré 5 bultos de concentrado';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });

    await h.handler.handle(textMessage(text), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe(HANDLE_INCOMING_MESSAGE_MESSAGES.inviteRegister);
    expect(h.eventExtractor.calls).toHaveLength(0);
    expect(h.farmEventStore.events).toHaveLength(0);
  });

  it('baja confianza (< 0.6) → cae a AnswerQuery', async () => {
    const h = buildHarness();
    const text = 'tengo un lote nuevo';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.4 });

    await h.handler.handle(textMessage(text), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe(GENERATOR_ANSWER);
    expect(h.eventExtractor.calls).toHaveLength(0);
  });

  it('pending expirado + "Sí" → "No tengo nada pendiente de confirmar"', async () => {
    const h = buildHarness();
    seedOperator(h);
    const text = 'le di 3 bultos de concentrado a la ceba';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });
    h.eventExtractor.respuestas.set(text, feedDeliveryDraft());
    await h.handler.handle(textMessage(text), h.gateway);

    h.clock.advanceSeconds(700); // TTL default 600s
    h.intentClassifier.respuestas.set('Sí', { kind: 'confirm', confidence: 0.9 });

    await h.handler.handle(textMessage('Sí'), h.gateway);

    expect(h.gateway.sent[1]?.text).toBe(
      'No tengo nada pendiente de confirmar. ¿Me repites el registro?',
    );
    expect(h.farmEventStore.events).toHaveLength(0);
  });

  it('voz: transcribe una sola vez y responde en voz', async () => {
    const h = buildHarness();

    await h.handler.handle(voiceMessage(), h.gateway);

    expect(h.transcriber.calls).toHaveLength(1);
    expect(h.gateway.sent[0]?.type).toBe('voice');
    expect(h.gateway.sent[0]?.audio).toBeDefined();
  });

  it('clasificador falla (err) → cae a AnswerQuery (v1 nunca queda peor)', async () => {
    const h = buildHarness();
    seedOperator(h);
    h.intentClassifier.failure = { kind: 'provider_failure', message: 'llm caído' };

    await h.handler.handle(textMessage('¿algo pasa con mis cerdas?'), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe(GENERATOR_ANSWER);
    expect(h.eventExtractor.calls).toHaveLength(0);
  });

  // ── Alta de granja para usuario anónimo (Corte 1, tarea 6) ────────────

  // El alta ya no es el flujo mínimo de v1.1 (nombre → "¿la creo?"): el spec
  // 001 la reemplazó por una conversación multi-turno que arranca por el rol.
  // Aquí se prueba el ENRUTADO del orquestador; los pasos internos de la
  // conversación tienen su propia suite.

  it('anónimo + onboarding → arranca la conversación de registro por el rol', async () => {
    const h = buildHarness();
    const text = 'quiero registrar mi granja Villa Clara';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });

    await h.handler.handle(textMessage(text), h.gateway);

    expect(h.gateway.sent[0]?.text).toContain(
      '¿Eres el dueño/administrador de la finca o trabajas en ella?',
    );
    expect(await h.pendingEventStore.hasPending(chatHash('telegram', 'user-1'))).toBe(true);
  });

  it('el borrador de registro sobrevive a un "sí" corto (no lo consume ConfirmFarmEvent)', async () => {
    const h = buildHarness();
    const text = 'quiero registrarme';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });
    await h.handler.handle(textMessage(text), h.gateway);

    // El atajo determinista de "sí" apunta a ConfirmFarmEvent, que haría
    // takePending y destruiría el registro a medio hacer si el orquestador
    // no diera prioridad al borrador de onboarding bajo el hash del canal.
    await h.handler.handle(textMessage('sí'), h.gateway);

    expect(h.gateway.sent[1]?.text).not.toBe('Listo, lo descarté. No registré nada.');
    expect(await h.pendingEventStore.hasPending(chatHash('telegram', 'user-1'))).toBe(true);
    expect(await h.farmRepository.findOperatorByHash(chatHash('telegram', 'user-1'))).toBeNull();
  });

  it('elegir "Soy dueño" por botón avanza al número de celular', async () => {
    const h = buildHarness();
    const text = 'quiero registrarme';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });
    await h.handler.handle(textMessage(text), h.gateway);

    // Una pulsación llega como texto cuyo contenido es el id de la opción.
    const tap = 'reg:role:administrador_dueno';
    h.intentClassifier.respuestas.set(tap, { kind: 'onboarding', confidence: 0.9 });
    await h.handler.handle(textMessage(tap), h.gateway);

    expect(h.gateway.sent[1]?.text.toLowerCase()).toContain('celular');
    expect(await h.farmRepository.findOperatorByHash(chatHash('telegram', 'user-1'))).toBeNull();
  });

  it('saludo con registro pendiente repite el paso y vuelve a enviar sus botones', async () => {
    const gateway = new FakeInteractiveChannelGateway();
    const h = buildHarness(gateway);
    const text = 'quiero registrarme';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });

    await h.handler.handle(textMessage(text), gateway);
    await h.handler.handle(textMessage('hola'), gateway);

    expect(gateway.sent).toHaveLength(0);
    expect(gateway.interactiveSent[1]?.body).toBe(
      '¿Eres el dueño/administrador de la finca o trabajas en ella?',
    );
    expect(gateway.interactiveSent[1]?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Soy dueño o administrador' }),
      ]),
    );
  });

  it('el paso de celular usa un único teclado nativo, sin duplicar el texto', async () => {
    const gateway = new FakeInteractiveChannelGateway();
    const h = buildHarness(gateway);
    const text = 'quiero registrarme';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });

    await h.handler.handle(textMessage(text), gateway);
    const tap = 'reg:role:administrador_dueno';
    h.intentClassifier.respuestas.set(tap, { kind: 'onboarding', confidence: 0.9 });
    await h.handler.handle(textMessage(tap), gateway);

    expect(gateway.sent).toHaveLength(0);
    expect(gateway.contactRequests).toEqual([
      { channelUserId: 'user-1', body: '¿Cuál es tu número de celular? Puedes compartirlo o escribirlo.' },
    ]);
  });

  // ── Defecto de identidad de chat (hashed-zooming-flame.md, Tarea 1) ────
  //
  // Al registrar se hashea el celular en E.164 ("+573001234567"); al
  // recibir un mensaje de WhatsApp, el wa_id llega SIN "+" ("573001234567").
  // Sin normalización, los dos hashes nunca coinciden y nadie es reconocido
  // tras registrarse. Este test reproduce exactamente ese desajuste.

  it('reconoce por WhatsApp a quien se registró con el celular en E.164 (el wa_id llega sin +)', async () => {
    const h = buildHarness();
    const operator: Operator = {
      id: 'operator-wa',
      userId: 'user-wa',
      farmId: FARM_ID,
      channelUserHash: hashUserId('+573001234567'),
      role: 'trabajador',
      status: 'activo',
    };
    h.farmRepository.seedOperator(buildFarm(), operator);

    const message = {
      channel: 'whatsapp' as const,
      channelUserId: '573001234567',
      messageId: 'msg-wa-1',
      type: 'text' as const,
      text: '¿cuánto me queda de concentrado?',
      receivedAt: new Date(),
    };
    h.intentClassifier.respuestas.set('¿cuánto me queda de concentrado?', {
      kind: 'query_state',
      confidence: 0.9,
    });

    await h.handler.handle(message, h.gateway);

    expect(h.farmRepository.lastLookupHash).toBe(hashUserId('+573001234567'));
  });
});
