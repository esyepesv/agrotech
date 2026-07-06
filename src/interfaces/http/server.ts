import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv, type Env } from '../../config/env.js';
import { buildContainer } from '../../config/container.js';
import { createLogger } from '../../shared/logger.js';
import { ConfigurationError } from '../../shared/errors.js';
import { AnswerQueryDispatcher } from './dispatcher.js';
import { registerTelegramWebhook } from './telegram-webhook.js';
import { registerWhatsAppWebhook } from './whatsapp-webhook.js';

/**
 * Servidor HTTP delgado (sección 10): solo expone webhooks y un health
 * check. Toda la lógica vive en el container/caso de uso. Exportado como
 * función para que los tests puedan construirlo sin arrancar el proceso.
 */
export function buildServer(env: Env): FastifyInstance {
  const logger = createLogger(env.LOG_LEVEL);
  const container = buildContainer(env, logger);
  const dispatcher = new AnswerQueryDispatcher(container, logger);

  // Fastify construye su propio logger pino interno a partir de la config
  // (no se le pasa nuestra instancia: evita el desajuste de tipos entre
  // pino.Logger y FastifyBaseLogger). El `logger` de shared/logger.ts se usa
  // para el logging de aplicación (dispatcher, errores de negocio).
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  app.get('/health', (_request, reply) => reply.code(200).send({ status: 'ok' }));

  // Se registra cada canal cuyas credenciales estén presentes, así el bot
  // puede atender Telegram y WhatsApp a la vez. ACTIVE_CHANNEL ya no limita
  // qué webhooks se exponen; solo indica el canal principal.
  const registered: string[] = [];

  if (env.TELEGRAM_BOT_TOKEN !== undefined) {
    registerTelegramWebhook(app, dispatcher);
    registered.push('telegram');
  }

  if (
    env.WHATSAPP_TOKEN !== undefined &&
    env.WHATSAPP_PHONE_NUMBER_ID !== undefined &&
    env.WHATSAPP_VERIFY_TOKEN !== undefined
  ) {
    registerWhatsAppWebhook(app, dispatcher, {
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      appSecret: env.WHATSAPP_APP_SECRET,
      logger,
    });
    registered.push('whatsapp');
  }

  if (registered.length === 0) {
    throw new ConfigurationError(
      'Ningún canal configurado: define credenciales de Telegram y/o WhatsApp',
    );
  }

  return app;
}

async function main(): Promise<void> {
  // En desarrollo se carga el .env local; en producción las variables las
  // provee la plataforma, así que la carga es opcional (no falla si no existe).
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const env = loadEnv();
  const app = buildServer(env);
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

const isMainModule = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMainModule) {
  main().catch((error: unknown) => {
    // El logger de aplicación depende de un env válido; si loadEnv falla,
    // no hay logger disponible, así que se usa console como último recurso.
    console.error(error);
    process.exit(1);
  });
}
