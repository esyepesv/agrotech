import { loadEnv, type Env } from '../../config/env.js';
import { buildContainer, type Container } from '../../config/container.js';
import { createLogger, type Logger } from '../../shared/logger.js';
import { SeenMessages } from '../http/dedup.js';
import type { IncomingMessage } from '../../domain/message/incoming-message.js';
import {
  createRegistrationHandlers,
  type RegistrationHandlers,
  type RegistrationHttpDeps,
} from '../http/register-routes.js';

interface ServerlessRuntime {
  readonly env: Env;
  readonly container: Container;
  readonly logger: Logger;
  readonly seen: SeenMessages;
}

// Memoizado a nivel de módulo: Vercel reutiliza la misma instancia del
// runtime de Node entre invocaciones consecutivas de una función caliente,
// así que este módulo se evalúa una sola vez por instancia y el container
// (clientes HTTP, Supabase, etc.) no se reconstruye en cada request.
let runtime: ServerlessRuntime | undefined;

function getRuntime(): ServerlessRuntime {
  if (runtime === undefined) {
    // loadEnv() sin argumento lee process.env; en Vercel las variables de
    // entorno configuradas en el dashboard llegan ahí directamente (no hay
    // .env que cargar, a diferencia del servidor Fastify local).
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const container = buildContainer(env, logger);
    const seen = new SeenMessages();

    // #1 hardening: si el App Secret de Meta no está configurado, se omite
    // la verificación de X-Hub-Signature-256 (ver api/webhook/whatsapp.ts)
    // en vez de romper el webhook; se advierte una sola vez por instancia
    // caliente en vez de en cada request.
    if (env.WHATSAPP_TOKEN !== undefined && env.WHATSAPP_APP_SECRET === undefined) {
      logger.warn(
        'WHATSAPP_APP_SECRET no configurado: se omite la verificación de X-Hub-Signature-256 en el webhook de WhatsApp',
      );
    }

    runtime = { env, container, logger, seen };
  }
  return runtime;
}

/**
 * Expone el Env memoizado para los handlers que necesitan leer alguna
 * variable directamente (p. ej. WHATSAPP_VERIFY_TOKEN en el GET de
 * verificación del webhook de WhatsApp, o WHATSAPP_APP_SECRET para
 * verificar la firma del POST).
 */
export function getEnv(): Env {
  return getRuntime().env;
}

/**
 * Expone el logger memoizado para los handlers de api/ que necesiten
 * registrar eventos (p. ej. una firma inválida) sin loguear nunca secretos.
 */
export function getLogger(): Logger {
  return getRuntime().logger;
}

/**
 * Réplica serverless de AnswerQueryDispatcher (src/interfaces/http/dispatcher.ts):
 * misma semántica de deduplicación por messageId (L1 en memoria + L2
 * Supabase, dedup hardening) y logging de errores sin propagarlos al
 * proveedor. A diferencia del dispatcher (fire-and-forget), esta función
 * devuelve la promesa para que el handler la entregue a waitUntil y la
 * función serverless no se congele/recicle antes de que termine de procesar
 * el mensaje en background.
 */
export async function processIncoming(message: IncomingMessage): Promise<void> {
  const { container, logger, seen } = getRuntime();

  if (!seen.firstSight(message.messageId)) {
    logger.debug({ messageId: message.messageId }, 'mensaje duplicado ignorado (L1 en memoria)');
    return;
  }

  try {
    const firstSight = await container.deduplicator.firstSight(message.messageId);
    if (!firstSight) {
      logger.debug({ messageId: message.messageId }, 'mensaje duplicado ignorado (L2 Supabase)');
      return;
    }

    const gateway = container.resolveGateway(message.channel);
    // v1.1: el orquestador enruta por intención; una pregunta de
    // conocimiento sigue cayendo en AnswerQuery (rama por defecto).
    await container.handleIncomingMessage.handle(message, gateway);
  } catch (error: unknown) {
    logger.error(
      { err: error, messageId: message.messageId, channel: message.channel },
      'fallo al procesar mensaje entrante',
    );
  }
}

// Memoizado aparte de `runtime` (y no dentro de `ServerlessRuntime`) porque
// `createRegistrationHandlers` construye los `OtpRateLimiter` en memoria
// (spec 001 §4.2/§5, ver otp-rate-limiter.ts): deben existir una única vez
// por instancia caliente de función, igual que el resto de este módulo, sin
// forzar a `getRuntime()` a conocer el tipo `RegistrationHandlers`.
let registrationHandlers: RegistrationHandlers | undefined;

/**
 * Handlers HTTP-agnósticos de `/register/*` para los endpoints serverless
 * (`api/register/*.ts`), memoizados por instancia. Usa
 * `container.registration` (cableado en `config/container.ts`, fuera de
 * este archivo) — el mismo objeto que consume `registerRegistrationRoutes`
 * en el servidor Fastify local, así que ninguna lógica de negocio se
 * duplica entre las dos superficies.
 */
export function getRegistrationHandlers(): RegistrationHandlers {
  if (registrationHandlers === undefined) {
    registrationHandlers = createRegistrationHandlers(getRuntime().container.registration);
  }
  return registrationHandlers;
}

/**
 * Config de registro memoizada (para que `api/register/_cors.ts` sepa qué
 * orígenes permitir sin reconstruir el container en cada handler). Mismo
 * objeto que usan los handlers de arriba.
 */
export function getRegistrationConfig(): RegistrationHttpDeps['config'] {
  return getRuntime().container.registration.config;
}
