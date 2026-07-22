import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Channel } from '../domain/message/incoming-message.js';
import { AnswerQuery } from '../application/use-cases/answer-query.js';
import { ConfirmFarmEvent } from '../application/use-cases/confirm-farm-event.js';
import { HandleIncomingMessage } from '../application/use-cases/handle-incoming-message.js';
import { LogFarmEvent } from '../application/use-cases/log-farm-event.js';
import { QueryFarmState } from '../application/use-cases/query-farm-state.js';
import { ApproveWorker } from '../application/use-cases/approve-worker.js';
import { RegisterFarmAndUser } from '../application/use-cases/register-farm-and-user.js';
import { RegisterFarmAndUserConversation } from '../application/use-cases/register-farm-and-user-conversation.js';
import type { RegistrationHttpDeps } from '../interfaces/http/register-routes.js';
import type { OtpTransportSender } from '../application/ports/otp-sender.js';
import { SupabaseOtpStore } from '../infrastructure/persistence/supabase-otp-store.js';
import { ChannelOtpSender } from '../infrastructure/security/channel-otp-sender.js';
import { RoutingOtpSender } from '../infrastructure/security/routing-otp-sender.js';
import { SmtpEmailSender } from '../infrastructure/security/smtp-email-sender.js';
import { TwilioSmsSender } from '../infrastructure/security/twilio-sms-sender.js';
import { JwtSessionIssuer } from '../infrastructure/security/jwt-session-issuer.js';
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
  /** Dependencias de la API de registro web (spec 001 §4.2). */
  readonly registration: RegistrationHttpDeps;
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

  // ── Registro de usuario + granja (v1.2, spec 001) ──────────────────────
  const hashUserIdWithSalt = (raw: string): string => hashUserId(raw, env.USER_ID_SALT);

  const registerFarmAndUser = new RegisterFarmAndUser({
    farmRepository,
    clock,
    idGenerator: randomUUID,
    hashUserId: hashUserIdWithSalt,
  });
  const approveWorker = new ApproveWorker({ farmRepository, clock });

  const resolveGateway = buildGatewayResolver(env);

  // Reemplaza a RegisterFarm (v1.1): mismo lugar en el router de intención,
  // pero flujo multi-turno completo con botones y voz (spec 001 §4.1).
  const onboarding = new RegisterFarmAndUserConversation({
    registerFarmAndUser,
    approveWorker,
    farmRepository,
    pendingEventStore,
    clock,
    pendingTtlSeconds: env.ONBOARDING_PENDING_TTL_SECONDS,
  });

  // Transportes de OTP: solo entran al enrutador los que tengan credenciales;
  // `isConfigured()` de cada uno decide si se le ofrece al usuario.
  const transportSenders: OtpTransportSender[] = [
    new ChannelOtpSender('whatsapp', resolveGateway),
    new ChannelOtpSender('telegram', resolveGateway),
  ];
  if (env.TWILIO_ACCOUNT_SID !== undefined && env.TWILIO_AUTH_TOKEN !== undefined) {
    transportSenders.push(
      new TwilioSmsSender({
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        ...(env.TWILIO_FROM_NUMBER === undefined ? {} : { from: env.TWILIO_FROM_NUMBER }),
        ...(env.TWILIO_MESSAGING_SERVICE_SID === undefined
          ? {}
          : { messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID }),
      }),
    );
  }
  if (
    env.SMTP_HOST !== undefined &&
    env.SMTP_USER !== undefined &&
    env.SMTP_PASSWORD !== undefined &&
    env.SMTP_FROM !== undefined
  ) {
    transportSenders.push(
      new SmtpEmailSender({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.SMTP_FROM,
        ttlMinutes: Math.round(env.OTP_TTL_SECONDS / 60),
      }),
    );
  }

  const registration: RegistrationHttpDeps = {
    registerFarmAndUser,
    farmRepository,
    // El pepper del hash del código es el mismo USER_ID_SALT: el código nunca
    // se guarda en claro (spec 001 §4.2).
    otpStore: new SupabaseOtpStore(supabase, clock, env.USER_ID_SALT),
    otpSender: new RoutingOtpSender(transportSenders),
    sessionIssuer: new JwtSessionIssuer(env.SESSION_JWT_SECRET),
    clock,
    hashUserId: hashUserIdWithSalt,
    config: {
      otpTtlSeconds: env.OTP_TTL_SECONDS,
      otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
      otpVerifiedGraceSeconds: env.OTP_VERIFIED_GRACE_SECONDS,
      otpResendCooldownSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
      otpRateLimitPerHour: env.OTP_RATE_LIMIT_PER_HOUR,
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
      corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
    },
  };

  const handleIncomingMessage = new HandleIncomingMessage({
    answerQuery,
    logFarmEvent,
    confirmFarmEvent,
    queryFarmState,
    onboarding,
    intentClassifier: new LlmIntentClassifier(openrouter, env.INTENT_MODEL),
    farmRepository,
    pendingEventStore,
    transcriber: new WhisperTranscriber(openai, env.STT_MODEL),
    synthesizer: new TtsSynthesizer(openai, env.TTS_MODEL, env.TTS_VOICE),
    conversationLog: new SupabaseConversationLog(supabase, env.USER_ID_SALT),
    hashUserId: (channelUserId) => hashUserId(channelUserId, env.USER_ID_SALT),
  });

  const deduplicator = new SupabaseMessageDeduplicator(supabase, logger);

  return {
    answerQuery,
    handleIncomingMessage,
    resolveGateway,
    activeChannel: env.ACTIVE_CHANNEL,
    deduplicator,
    registration,
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
