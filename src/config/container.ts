import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Channel } from '../domain/message/incoming-message.js';
import { AnswerQuery } from '../application/use-cases/answer-query.js';
import { ConfirmFarmEvent } from '../application/use-cases/confirm-farm-event.js';
import { HandleIncomingMessage } from '../application/use-cases/handle-incoming-message.js';
import { LogFarmEvent } from '../application/use-cases/log-farm-event.js';
import { QueryFarmState } from '../application/use-cases/query-farm-state.js';
import { RegisterFarm } from '../application/use-cases/register-farm.js';
import type { ChannelGateway } from '../application/ports/channel-gateway.js';
import type { MessageDeduplicator } from '../application/ports/message-deduplicator.js';
import { WhisperTranscriber } from '../infrastructure/speech/whisper-transcriber.js';
import { TtsSynthesizer } from '../infrastructure/speech/tts-synthesizer.js';
import { LlmAnswerGenerator } from '../infrastructure/llm/llm-answer-generator.js';
import { LlmEmbedder } from '../infrastructure/llm/llm-embedder.js';
import { PgVectorRetriever } from '../infrastructure/knowledge/pgvector-retriever.js';
import { RuleBasedSafetyPolicy } from '../infrastructure/safety/rule-based-safety-policy.js';
import { SupabaseConversationLog } from '../infrastructure/persistence/supabase-conversation-log.js';
import { SupabaseMessageDeduplicator } from '../infrastructure/persistence/supabase-message-deduplicator.js';
import { TelegramGateway } from '../infrastructure/channels/telegram-gateway.js';
import { WhatsAppGateway } from '../infrastructure/channels/whatsapp-gateway.js';
import { LlmEventExtractor } from '../infrastructure/extraction/llm-event-extractor.js';
import { LlmIntentClassifier } from '../infrastructure/intent/llm-intent-classifier.js';
import { SupabaseFarmEventStore } from '../infrastructure/persistence/supabase-farm-event-store.js';
import { SupabaseFarmRepository } from '../infrastructure/persistence/supabase-farm-repository.js';
import { SupabaseInventoryRepository } from '../infrastructure/persistence/supabase-inventory-repository.js';
import { SupabaseLotRepository } from '../infrastructure/persistence/supabase-lot-repository.js';
import { SupabasePendingEventStore } from '../infrastructure/persistence/supabase-pending-event-store.js';
import { SupabaseSowRepository } from '../infrastructure/persistence/supabase-sow-repository.js';
import { RuleBasedEventSafetyPolicy } from '../infrastructure/safety/rule-based-event-safety-policy.js';
import { hashUserId } from '../infrastructure/security/user-id-hash.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import type { Logger } from '../shared/logger.js';
import type { Env } from './env.js';

/**
 * Único lugar que conoce las clases concretas (sección 7). Construye los
 * adaptadores y los inyecta en el caso de uso. Sin framework de DI:
 * una función fábrica basta y es más legible.
 */
export interface Container {
  readonly answerQuery: AnswerQuery;
  /** Orquestador v1.1: router de intención con AnswerQuery como rama por defecto. */
  readonly handleIncomingMessage: HandleIncomingMessage;
  readonly resolveGateway: (channel: Channel) => ChannelGateway;
  readonly activeChannel: Channel;
  readonly deduplicator: MessageDeduplicator;
}

export function buildContainer(env: Env, logger: Logger): Container {
  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const openrouter = new OpenAI({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL });
  // La resolución de genéricos por defecto de @supabase/supabase-js hace que
  // el tipo "pelado" SupabaseClient no case exactamente con el que infiere
  // createClient(); es un desajuste conocido del SDK, no un any real.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const supabase: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const embedder = new LlmEmbedder(openai, env.EMBEDDINGS_MODEL);

  const answerQuery = new AnswerQuery({
    transcriber: new WhisperTranscriber(openai, env.STT_MODEL),
    synthesizer: new TtsSynthesizer(openai, env.TTS_MODEL, env.TTS_VOICE),
    retriever: new PgVectorRetriever(supabase, embedder),
    generator: new LlmAnswerGenerator(openrouter, env.LLM_MODEL),
    safetyPolicy: new RuleBasedSafetyPolicy(),
    conversationLog: new SupabaseConversationLog(supabase, env.USER_ID_SALT),
    minRelevanceScore: env.RAG_MIN_SCORE,
  });

  // ── Módulo farm (v1.1) ────────────────────────────────────────────────
  const clock = new SystemClock();
  const farmRepository = new SupabaseFarmRepository(supabase);
  const inventoryRepository = new SupabaseInventoryRepository(supabase);
  const sowRepository = new SupabaseSowRepository(supabase);
  const lotRepository = new SupabaseLotRepository(supabase);
  const farmEventStore = new SupabaseFarmEventStore(supabase);
  const pendingEventStore = new SupabasePendingEventStore(supabase, clock);

  const logFarmEvent = new LogFarmEvent({
    eventExtractor: new LlmEventExtractor(openrouter, env.EXTRACTOR_MODEL),
    eventSafetyPolicy: new RuleBasedEventSafetyPolicy(),
    pendingEventStore,
    clock,
    pendingTtlSeconds: env.PENDING_EVENT_TTL_SECONDS,
  });

  const confirmFarmEvent = new ConfirmFarmEvent({
    pendingEventStore,
    farmEventStore,
    inventoryRepository,
    sowRepository,
    lotRepository,
    farmRepository,
    clock,
    idGenerator: randomUUID,
  });

  const queryFarmState = new QueryFarmState({ inventoryRepository, farmEventStore, clock });

  const registerFarm = new RegisterFarm({
    farmRepository,
    pendingEventStore,
    clock,
    idGenerator: randomUUID,
    pendingTtlSeconds: env.PENDING_EVENT_TTL_SECONDS,
  });

  const handleIncomingMessage = new HandleIncomingMessage({
    answerQuery,
    logFarmEvent,
    confirmFarmEvent,
    queryFarmState,
    registerFarm,
    intentClassifier: new LlmIntentClassifier(openrouter, env.INTENT_MODEL),
    farmRepository,
    pendingEventStore,
    transcriber: new WhisperTranscriber(openai, env.STT_MODEL),
    synthesizer: new TtsSynthesizer(openai, env.TTS_MODEL, env.TTS_VOICE),
    conversationLog: new SupabaseConversationLog(supabase, env.USER_ID_SALT),
    hashUserId: (channelUserId) => hashUserId(channelUserId, env.USER_ID_SALT),
  });

  const resolveGateway = buildGatewayResolver(env);
  const deduplicator = new SupabaseMessageDeduplicator(supabase, logger);

  return {
    answerQuery,
    handleIncomingMessage,
    resolveGateway,
    activeChannel: env.ACTIVE_CHANNEL,
    deduplicator,
  };
}

/**
 * El ChannelGateway es específico del canal que recibió el mensaje, así
 * que se resuelve por canal y se pasa al caso de uso en la invocación.
 * Cada gateway se construye una vez (lazy) y se reutiliza.
 */
function buildGatewayResolver(env: Env): (channel: Channel) => ChannelGateway {
  const cache = new Map<Channel, ChannelGateway>();

  return (channel: Channel): ChannelGateway => {
    const cached = cache.get(channel);
    if (cached !== undefined) {
      return cached;
    }
    const gateway = createGateway(channel, env);
    cache.set(channel, gateway);
    return gateway;
  };
}

function createGateway(channel: Channel, env: Env): ChannelGateway {
  if (channel === 'telegram') {
    if (env.TELEGRAM_BOT_TOKEN === undefined) {
      throw new Error('TELEGRAM_BOT_TOKEN no configurado');
    }
    return new TelegramGateway(env.TELEGRAM_BOT_TOKEN);
  }

  if (env.WHATSAPP_TOKEN === undefined || env.WHATSAPP_PHONE_NUMBER_ID === undefined) {
    throw new Error('credenciales de WhatsApp no configuradas');
  }
  return new WhatsAppGateway({
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  });
}
