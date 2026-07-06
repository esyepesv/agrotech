import { loadEnv, type Env } from '../../config/env.js';
import { buildContainer, type Container } from '../../config/container.js';
import { createLogger, type Logger } from '../../shared/logger.js';
import { SeenMessages } from '../http/dedup.js';
import type { IncomingMessage } from '../../domain/message/incoming-message.js';

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
    const container = buildContainer(env);
    const logger = createLogger(env.LOG_LEVEL);
    const seen = new SeenMessages();
    runtime = { env, container, logger, seen };
  }
  return runtime;
}

/**
 * Expone el Env memoizado para los handlers que necesitan leer alguna
 * variable directamente (p. ej. WHATSAPP_VERIFY_TOKEN en el GET de
 * verificación del webhook de WhatsApp).
 */
export function getEnv(): Env {
  return getRuntime().env;
}

/**
 * Réplica serverless de AnswerQueryDispatcher (src/interfaces/http/dispatcher.ts):
 * misma semántica de deduplicación por messageId y logging de errores sin
 * propagarlos al proveedor. A diferencia del dispatcher (fire-and-forget),
 * esta función devuelve la promesa para que el handler la entregue a
 * waitUntil y la función serverless no se congele/recicle antes de que
 * termine de procesar el mensaje en background.
 */
export function processIncoming(message: IncomingMessage): Promise<void> {
  const { container, logger, seen } = getRuntime();

  if (!seen.firstSight(message.messageId)) {
    logger.debug({ messageId: message.messageId }, 'mensaje duplicado ignorado');
    return Promise.resolve();
  }

  const gateway = container.resolveGateway(message.channel);
  return container.answerQuery.handle(message, gateway).catch((error: unknown) => {
    logger.error(
      { err: error, messageId: message.messageId, channel: message.channel },
      'fallo al procesar mensaje entrante',
    );
  });
}
