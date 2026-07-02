import { z } from 'zod';
import { ConfigurationError } from '../shared/errors.js';

const envSchema = z
  .object({
    WHATSAPP_TOKEN: z.string().min(1).optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),

    LLM_API_KEY: z.string().min(1),
    LLM_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
    LLM_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.5'),

    OPENAI_API_KEY: z.string().min(1),
    STT_MODEL: z.string().min(1).default('whisper-1'),
    TTS_MODEL: z.string().min(1).default('tts-1'),
    TTS_VOICE: z.string().min(1).default('alloy'),
    EMBEDDINGS_MODEL: z.string().min(1).default('text-embedding-3-small'),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_KEY: z.string().min(1),

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
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigurationError(`Configuración inválida:\n${detail}`);
  }
  return parsed.data;
}
