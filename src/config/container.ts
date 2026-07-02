import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Channel } from '../domain/message/incoming-message.js';
import { AnswerQuery } from '../application/use-cases/answer-query.js';
import type { ChannelGateway } from '../application/ports/channel-gateway.js';
import { WhisperTranscriber } from '../infrastructure/speech/whisper-transcriber.js';
import { TtsSynthesizer } from '../infrastructure/speech/tts-synthesizer.js';
import { LlmAnswerGenerator } from '../infrastructure/llm/llm-answer-generator.js';
import { LlmEmbedder } from '../infrastructure/llm/llm-embedder.js';
import { PgVectorRetriever } from '../infrastructure/knowledge/pgvector-retriever.js';
import { RuleBasedSafetyPolicy } from '../infrastructure/safety/rule-based-safety-policy.js';
import { SupabaseConversationLog } from '../infrastructure/persistence/supabase-conversation-log.js';
import { TelegramGateway } from '../infrastructure/channels/telegram-gateway.js';
import { WhatsAppGateway } from '../infrastructure/channels/whatsapp-gateway.js';
import type { Env } from './env.js';

/**
 * Único lugar que conoce las clases concretas (sección 7). Construye los
 * adaptadores y los inyecta en el caso de uso. Sin framework de DI:
 * una función fábrica basta y es más legible.
 */
export interface Container {
  readonly answerQuery: AnswerQuery;
  readonly resolveGateway: (channel: Channel) => ChannelGateway;
  readonly activeChannel: Channel;
}

export function buildContainer(env: Env): Container {
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
    conversationLog: new SupabaseConversationLog(supabase),
  });

  const resolveGateway = buildGatewayResolver(env);

  return { answerQuery, resolveGateway, activeChannel: env.ACTIVE_CHANNEL };
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
