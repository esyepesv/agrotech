import { describe, expect, it } from 'vitest';
import type { Farm } from '../../src/domain/farm/farm.js';
import type { FarmEventDraft, FeedDelivery } from '../../src/domain/farm/farm-event.js';
import type { Operator } from '../../src/domain/farm/operator.js';
import type { IncomingMessage } from '../../src/domain/message/incoming-message.js';
import { AnswerQuery } from '../../src/application/use-cases/answer-query.js';
import { ConfirmFarmEvent } from '../../src/application/use-cases/confirm-farm-event.js';
import {
  HANDLE_INCOMING_MESSAGE_MESSAGES,
  HandleIncomingMessage,
} from '../../src/application/use-cases/handle-incoming-message.js';
import { LogFarmEvent } from '../../src/application/use-cases/log-farm-event.js';
import { QueryFarmState } from '../../src/application/use-cases/query-farm-state.js';
import { RegisterFarm } from '../../src/application/use-cases/register-farm.js';
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
const OPERATOR_HASH = `${HASH_PREFIX}user-1`;

function hashUserId(channelUserId: string): string {
  return `${HASH_PREFIX}${channelUserId}`;
}

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
  return { id: 'operator-1', farmId: FARM_ID, channelUserHash: OPERATOR_HASH, role: 'operario' };
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

function buildHarness() {
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
  const gateway = new FakeChannelGateway();

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

  const registerFarm = new RegisterFarm({ farmRepository, pendingEventStore, clock, idGenerator });

  const handler = new HandleIncomingMessage({
    answerQuery,
    logFarmEvent,
    confirmFarmEvent,
    queryFarmState,
    registerFarm,
    intentClassifier,
    farmRepository,
    pendingEventStore,
    transcriber,
    synthesizer,
    conversationLog,
    hashUserId,
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

  it('anónimo + onboarding con nombre → propone crear la granja con ese nombre', async () => {
    const h = buildHarness();
    const text = 'quiero registrar mi granja Villa Clara';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });

    await h.handler.handle(textMessage(text), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe(
      '¿Creo tu granja con el nombre "Villa Clara"? Di sí para confirmar.',
    );
    expect(await h.pendingEventStore.hasPending(hashUserId('user-1'))).toBe(true);
  });

  it('anónimo + "sí" tras proponer la granja → crea granja y operario (queda registrado)', async () => {
    const h = buildHarness();
    const text = 'quiero registrar mi granja Villa Clara';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });
    await h.handler.handle(textMessage(text), h.gateway);

    await h.handler.handle(textMessage('sí'), h.gateway);

    expect(h.gateway.sent[1]?.text).toContain('creé tu granja "Villa Clara"');
    const registered = await h.farmRepository.findOperatorByHash(hashUserId('user-1'));
    expect(registered).not.toBeNull();
    expect(registered?.farm.name).toBe('Villa Clara');
    expect(registered?.operator.role).toBe('admin');
  });

  it('anónimo + "no" tras proponer la granja → descarta y no crea nada', async () => {
    const h = buildHarness();
    const text = 'quiero registrar mi granja Villa Clara';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });
    await h.handler.handle(textMessage(text), h.gateway);

    await h.handler.handle(textMessage('no'), h.gateway);

    expect(h.gateway.sent[1]?.text).toBe('Listo, lo descarté. No registré nada.');
    expect(await h.farmRepository.findOperatorByHash(hashUserId('user-1'))).toBeNull();
  });

  it('anónimo + onboarding sin nombre (solo frase de intención) → pregunta el nombre', async () => {
    const h = buildHarness();
    const text = 'quiero registrarme';
    h.intentClassifier.respuestas.set(text, { kind: 'onboarding', confidence: 0.9 });

    await h.handler.handle(textMessage(text), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe('¿Cómo se llama tu granja?');
  });
});
