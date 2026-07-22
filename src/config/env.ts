import { z } from 'zod';
import { ConfigurationError } from '../shared/errors.js';

const envSchema = z
  .object({
    WHATSAPP_TOKEN: z.string().min(1).optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
    // App Secret de Meta (#1 hardening): si está definido, se exige y
    // verifica la firma X-Hub-Signature-256 en el POST del webhook de
    // WhatsApp. Opcional para no romper despliegues existentes antes de
    // configurarlo (se loguea una advertencia mientras tanto).
    WHATSAPP_APP_SECRET: z.string().min(1).optional(),
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),

    LLM_API_KEY: z.string().min(1),
    LLM_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
    LLM_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.5'),

    OPENAI_API_KEY: z.string().min(1),
    STT_MODEL: z.string().min(1).default('whisper-1'),
    ELEVENLABS_API_KEY: z.string().min(1),
    ELEVENLABS_VOICE_ID: z.string().min(1).default('TsKSGPuG26FpNj0JzQBq'),
    ELEVENLABS_MODEL: z.string().min(1).default('eleven_multilingual_v2'),
    ELEVENLABS_OUTPUT_FORMAT: z.string().min(1).default('opus_48000_64'),
    EMBEDDINGS_MODEL: z.string().min(1).default('text-embedding-3-small'),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_KEY: z.string().min(1),

    // Pepper secreto para el HMAC del hash de usuario (#2 hardening):
    // reemplaza el SHA-256 pelado en SupabaseConversationLog. Requerido:
    // sin pepper, el hash sería reproducible por fuerza bruta.
    USER_ID_SALT: z.string().min(16),

    // Umbral mínimo de similitud (#3 hardening) para aceptar un chunk
    // recuperado como contexto válido en el grounding del RAG.
    RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),

    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    ACTIVE_CHANNEL: z.enum(['telegram', 'whatsapp']).default('telegram'),
  })
  .superRefine((env, ctx) => {
    if (env.ACTIVE_CHANNEL === 'telegram' && env.TELEGRAM_BOT_TOKEN === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_BOT_TOKEN'],
        message: 'requerido cuando ACTIVE_CHANNEL=telegram',
      });
    }
    if (env.ACTIVE_CHANNEL === 'whatsapp') {
      for (const key of [
        'WHATSAPP_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_VERIFY_TOKEN',
      ] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'requerido cuando ACTIVE_CHANNEL=whatsapp',
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Valida la configuración al arranque (fail-fast, sección 13):
 * si falta una variable, el proceso no levanta.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Una variable presente pero vacía (p. ej. `WHATSAPP_TOKEN=` en un .env
  // copiado de .env.example) se trata como ausente, para que .optional() y
  // los .default() apliquen en vez de fallar por .min(1)/.url().
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigurationError(`Configuración inválida:\n${detail}`);
  }
  return parsed.data;
}
