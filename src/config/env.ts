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

    // v1.1 — router de intención y extractor de eventos (módulo farm).
    // Mismo cliente OpenRouter que LLM_API_KEY; se configuran por MODELO
    // (no por proveedor) igual que LLM_MODEL. El clasificador usa un modelo
    // pequeño: corre en cada mensaje y debe ser rápido/barato (R1 del plan).
    INTENT_MODEL: z.string().min(1).default('anthropic/claude-haiku-4.5'),
    EXTRACTOR_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.5'),

    // TTL del estado conversacional (pending a confirmar); pasado esto, el
    // "sí" tardío ya no encuentra nada que confirmar (PLAN-v1.1.md §7).
    PENDING_EVENT_TTL_SECONDS: z.coerce.number().int().positive().default(600),

    OPENAI_API_KEY: z.string().min(1),
    STT_MODEL: z.string().min(1).default('whisper-1'),
    // TTS de respaldo (OpenAI): se usa cuando no hay llave de ElevenLabs.
    TTS_MODEL: z.string().min(1).default('tts-1'),
    TTS_VOICE: z.string().min(1).default('alloy'),
    // ElevenLabs OPCIONAL: si la llave está, es la voz del bot; si falta, se
    // sigue hablando con el TTS de OpenAI. Mismo criterio que los canales
    // ("se registran todos los canales cuyas credenciales estén presentes"):
    // una credencial ausente apaga una capacidad, no tumba el arranque.
    ELEVENLABS_API_KEY: z.string().min(1).optional(),
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

    // ── v1.2 — registro de usuario + granja (spec 001) ──────────────────
    // TTL del borrador de onboarding conversacional. Más largo que
    // PENDING_EVENT_TTL_SECONDS porque completar ~10 campos por voz toma
    // mucho más que confirmar un solo evento (spec 001 §5).
    ONBOARDING_PENDING_TTL_SECONDS: z.coerce.number().int().positive().default(1800),

    // OTP de la web (spec 001 §4.2). El código nunca se persiste en claro:
    // se guarda su HMAC con USER_ID_SALT como pepper.
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    // Ventana en la que un teléfono ya verificado puede completar el POST
    // /register sin volver a pedir código.
    OTP_VERIFIED_GRACE_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
    // Tope de solicitudes de código por teléfono y hora: cada envío cuesta
    // dinero en WhatsApp, así que el límite protege el bolsillo, no solo el
    // abuso.
    OTP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(3),

    // Transportes de OTP además de los canales de chat. Cada uno es
    // opcional: un transporte sin credenciales simplemente no se ofrece al
    // usuario. SMS resuelve el caso del número "frío", al que WhatsApp no
    // puede escribir sin plantilla aprobada.
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    // Remitente: un número comprado en Twilio o un Messaging Service SID.
    TWILIO_FROM_NUMBER: z.string().min(1).optional(),
    TWILIO_MESSAGING_SERVICE_SID: z.string().min(1).optional(),

    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(1).optional(),
    // Destino de los avisos de contactos enviados desde la landing pública.
    LEAD_NOTIFICATION_TO: z.string().email().default('porciacol@gmail.com'),

    // Secreto de firma de la sesión web (HS256). Requerido: sin él la API de
    // registro emitiría sesiones falsificables, así que el proceso no debe
    // levantar. 32 caracteres mínimo (p. ej. 64 hex aleatorios).
    SESSION_JWT_SECRET: z.string().min(32),
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

    // Orígenes permitidos para la app de registro (lista separada por comas).
    // Vacío = sin CORS habilitado (solo consumo desde el mismo origen).
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),

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
