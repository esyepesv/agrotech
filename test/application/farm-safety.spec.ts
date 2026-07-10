import { describe, expect, it } from 'vitest';
import type { Farm } from '../../src/domain/farm/farm.js';
import type { FarmEventDraft, MedicationApplication } from '../../src/domain/farm/farm-event.js';
import type { Operator } from '../../src/domain/farm/operator.js';
import type { IncomingMessage } from '../../src/domain/message/incoming-message.js';
import { ANSWER_QUERY_MESSAGES, AnswerQuery } from '../../src/application/use-cases/answer-query.js';
import { ConfirmFarmEvent } from '../../src/application/use-cases/confirm-farm-event.js';
import { HandleIncomingMessage } from '../../src/application/use-cases/handle-incoming-message.js';
import { LogFarmEvent } from '../../src/application/use-cases/log-farm-event.js';
import { QueryFarmState } from '../../src/application/use-cases/query-farm-state.js';
import { RegisterFarm } from '../../src/application/use-cases/register-farm.js';
import { RuleBasedEventSafetyPolicy } from '../../src/infrastructure/safety/rule-based-event-safety-policy.js';
import { RuleBasedSafetyPolicy } from '../../src/infrastructure/safety/rule-based-safety-policy.js';
import { FakeAnswerGenerator } from './fakes/fake-answer-generator.js';
import { FakeChannelGateway } from './fakes/fake-channel-gateway.js';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeConversationLog } from './fakes/fake-conversation-log.js';
import { FakeEventExtractor } from './fakes/fake-event-extractor.js';
import { FakeFarmEventStore } from './fakes/fake-farm-event-store.js';
import { FakeFarmRepository } from './fakes/fake-farm-repository.js';
import { FakeIntentClassifier } from './fakes/fake-intent-classifier.js';
import { FakeInventoryRepository } from './fakes/fake-inventory-repository.js';
import { FakeKnowledgeRetriever } from './fakes/fake-knowledge-retriever.js';
import { FakeLotRepository } from './fakes/fake-lot-repository.js';
import { FakePendingEventStore } from './fakes/fake-pending-event-store.js';
import { FakeSowRepository } from './fakes/fake-sow-repository.js';
import { FakeSpeechSynthesizer } from './fakes/fake-speech-synthesizer.js';
import { FakeTranscriber } from './fakes/fake-transcriber.js';

// Suite "trampa" de PLAN-v1.1.md §8: regresión de seguridad para el router
// nuevo. Usa las políticas de seguridad REALES (RuleBasedSafetyPolicy de v1
// y RuleBasedEventSafetyPolicy nueva), no los fakes, porque lo que se
// prueba es precisamente que las reglas de negocio reales sigan escalando.
// Los casos 4 y 5 (recordatorio sanitario / plan validado) dependen de
// SanitaryPlanProvider, que llega en Corte 4: se dejan como it.todo.

const MIN_RELEVANCE_SCORE = 0.35;
const FARM_ID = 'farm-1';
const OPERATOR_HASH = 'hash-user-1';

function hashUserId(channelUserId: string): string {
  return `hash-${channelUserId}`;
}

function textMessage(text: string): IncomingMessage {
  return {
    channel: 'telegram',
    channelUserId: 'user-1',
    messageId: 'msg-1',
    type: 'text',
    text,
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

function medicationDraft(): FarmEventDraft {
  const payload: MedicationApplication = {
    type: 'medication_application',
    chapeta: '214',
    product: 'oxitetraciclina',
    doseText: '5 ml',
    needsVetReview: true,
  };
  return {
    payload,
    confidence: 0.85,
    camposFaltantes: [],
    rawTranscript: 'le apliqué 5 ml de oxitetraciclina a la 214',
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
    safetyPolicy: new RuleBasedSafetyPolicy(),
    conversationLog,
    minRelevanceScore: MIN_RELEVANCE_SCORE,
  });

  const logFarmEvent = new LogFarmEvent({
    eventExtractor,
    eventSafetyPolicy: new RuleBasedEventSafetyPolicy(),
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
    farmRepository,
    farmEventStore,
    pendingEventStore,
    eventExtractor,
    intentClassifier,
  };
}

function seedOperator(h: ReturnType<typeof buildHarness>): void {
  h.farmRepository.seedOperator(buildFarm(), buildOperator());
}

describe('farm-safety (suite trampa PLAN-v1.1.md §8)', () => {
  it('1. "¿qué le doy a la cerda con fiebre?" → intent question → escalate_vet (v1)', async () => {
    const h = buildHarness();

    await h.handler.handle(textMessage('¿qué le doy a la cerda con fiebre?'), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe(ANSWER_QUERY_MESSAGES.escalation);
  });

  it('2. "¿cuántos ml de oxitetraciclina le pongo a la 214?" → escalate_vet aunque mencione una chapeta registrada', async () => {
    const h = buildHarness();
    seedOperator(h);

    await h.handler.handle(
      textMessage('¿cuántos ml de oxitetraciclina le pongo a la 214?'),
      h.gateway,
    );

    expect(h.gateway.sent[0]?.text).toBe(ANSWER_QUERY_MESSAGES.escalation);
  });

  it('3. "le apliqué 5 ml de oxitetraciclina a la 214" → se registra como hecho (register_flagged), sin validar la dosis', async () => {
    const h = buildHarness();
    seedOperator(h);
    const text = 'le apliqué 5 ml de oxitetraciclina a la 214';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });
    h.eventExtractor.respuestas.set(text, medicationDraft());

    await h.handler.handle(textMessage(text), h.gateway);

    const reply = h.gateway.sent[0]?.text ?? '';
    expect(reply).toContain('¿Confirmo?');
    expect(reply).toContain('la dosis la valida tu veterinario');
    // Nunca corrige ni sugiere una dosis distinta a la que dijo el operario.
    expect(reply).not.toMatch(/deber[íi]as aplicar|te recomiendo \d/);
  });

  it('6a. Draft de medicación pendiente + "sí" → persiste en el ledger con needsVetReview true', async () => {
    const h = buildHarness();
    seedOperator(h);
    const text = 'le apliqué 5 ml de oxitetraciclina a la 214';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });
    h.eventExtractor.respuestas.set(text, medicationDraft());
    await h.handler.handle(textMessage(text), h.gateway);

    await h.handler.handle(textMessage('sí'), h.gateway);

    expect(h.farmEventStore.events).toHaveLength(1);
    const payload = h.farmEventStore.events[0]?.payload;
    expect(payload?.type).toBe('medication_application');
    expect((payload as MedicationApplication).needsVetReview).toBe(true);
  });

  it('6b. Draft de medicación pendiente + "no" → descarta, nada en el ledger', async () => {
    const h = buildHarness();
    seedOperator(h);
    const text = 'le apliqué 5 ml de oxitetraciclina a la 214';
    h.intentClassifier.respuestas.set(text, { kind: 'log_event', confidence: 0.9 });
    h.eventExtractor.respuestas.set(text, medicationDraft());
    await h.handler.handle(textMessage(text), h.gateway);

    await h.handler.handle(textMessage('no'), h.gateway);

    expect(h.farmEventStore.events).toHaveLength(0);
  });

  it('8. Ambigua "la cerda no come y no le di comida" → clasifica question → escala (prioridad salud)', async () => {
    const h = buildHarness();
    seedOperator(h);

    await h.handler.handle(textMessage('la cerda no come y no le di comida'), h.gateway);

    expect(h.gateway.sent[0]?.text).toBe(ANSWER_QUERY_MESSAGES.escalation);
  });

  // Dependen de SanitaryPlanProvider + remind_from_plan (Corte 4).
  it.todo('4. Recordatorio sanitario sin plan validado → rehúsa');
  it.todo('5. "vacuné al lote 7" con plan validado → registra SanitaryTaskDone sin consejo adicional');
});
