import type { FastifyInstance } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import { z } from 'zod';
import type { IncomingMessage } from '../../domain/message/incoming-message.js';
import { verifyMetaSignature } from '../../infrastructure/security/meta-signature.js';
import type { Logger } from '../../shared/logger.js';
import type { WebhookDispatcher } from './dispatcher.js';

const SIGNATURE_HEADER = 'x-hub-signature-256';

const messageSchema = z.object({
  id: z.string(),
  from: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  audio: z.object({ id: z.string() }).optional(),
});

const payloadSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            messages: z.array(messageSchema).optional(),
          }),
        }),
      ),
    }),
  ),
});

const verifyQuerySchema = z.object({
  'hub.mode': z.string().optional(),
  'hub.challenge': z.string().optional(),
  'hub.verify_token': z.string().optional(),
});

/**
 * Traduce un payload de Meta Cloud API (WhatsApp) a IncomingMessage del
 * dominio. Función pura: no toca red ni estado, testeable sin credenciales.
 * Solo procesa el primer mensaje soportado (texto o audio) del payload.
 */
export function parseWhatsAppMessage(body: unknown): IncomingMessage | undefined {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return undefined;
  }

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const message = change.value.messages?.[0];
      if (message === undefined) {
        continue;
      }

      const receivedAt = new Date();

      if (message.type === 'audio' && message.audio !== undefined) {
        return {
          channel: 'whatsapp',
          channelUserId: message.from,
          messageId: message.id,
          type: 'voice',
          audioRef: { channel: 'whatsapp', mediaId: message.audio.id },
          receivedAt,
        };
      }

      if (
        message.type === 'text' &&
        message.text !== undefined &&
        message.text.body.trim().length > 0
      ) {
        return {
          channel: 'whatsapp',
          channelUserId: message.from,
          messageId: message.id,
          type: 'text',
          text: message.text.body,
          receivedAt,
        };
      }
    }
  }

  return undefined;
}

export interface WhatsAppWebhookOptions {
  readonly verifyToken: string;
  /** App Secret de Meta (#1 hardening). Si es undefined, se omite la verificación. */
  readonly appSecret?: string;
  readonly logger: Logger;
}

/**
 * Registra el webhook de WhatsApp (Fase 2): el GET de verificación de Meta
 * (reto hub.challenge) y el POST de mensajes entrantes. El controller
 * responde 200 rápido y nunca rompe frente al proveedor (sección 14).
 *
 * #1 hardening: si `appSecret` está definido, el POST verifica la firma
 * X-Hub-Signature-256 sobre el RAW body (vía el plugin fastify-raw-body,
 * registrado aquí y acotado a esta ruta) antes de parsear/despachar, y
 * responde 401 si falta o no coincide. Si no está definido, se omite la
 * verificación (se advierte una sola vez al registrar, no en cada request).
 */
export function registerWhatsAppWebhook(
  app: FastifyInstance,
  dispatcher: WebhookDispatcher,
  options: WhatsAppWebhookOptions,
): void {
  const { verifyToken, appSecret, logger } = options;

  if (appSecret === undefined) {
    logger.warn(
      'WHATSAPP_APP_SECRET no configurado: se omite la verificación de X-Hub-Signature-256 en el webhook de WhatsApp',
    );
  }

  // fastify-raw-body se registra como plugin: avvio (el boot de Fastify) lo
  // ejecuta de forma diferida, no en el mismo tick de esta llamada. Si las
  // rutas se declaran justo después SIN esperar a que el plugin termine de
  // arrancar, su hook `onRoute` todavía no existe cuando Fastify emite el
  // evento de la ruta, y `request.rawBody` queda `undefined` en runtime
  // (comprobado con un smoke test manual). Por eso las rutas se declaran
  // dentro de `.after()`, que sí espera a que el plugin termine de arrancar.
  app
    .register(fastifyRawBody, {
      field: 'rawBody',
      global: false,
      runFirst: true,
      encoding: false,
      routes: ['/webhook/whatsapp'],
    })
    .after((err) => {
      if (err) {
        throw err;
      }

      app.get('/webhook/whatsapp', (request, reply) => {
        const query = verifyQuerySchema.safeParse(request.query);
        const isValidHandshake =
          query.success &&
          query.data['hub.mode'] === 'subscribe' &&
          query.data['hub.verify_token'] === verifyToken;

        if (!isValidHandshake) {
          return reply.code(403).send();
        }
        return reply.code(200).send(query.data['hub.challenge'] ?? '');
      });

      app.post('/webhook/whatsapp', (request, reply) => {
        if (appSecret !== undefined) {
          const header = request.headers[SIGNATURE_HEADER];
          const signature = Array.isArray(header) ? header[0] : header;
          if (
            request.rawBody === undefined ||
            !verifyMetaSignature(request.rawBody, signature, appSecret)
          ) {
            logger.warn('firma X-Hub-Signature-256 inválida o ausente en el webhook de WhatsApp');
            return reply.code(401).send();
          }
        }

        const message = parseWhatsAppMessage(request.body);
        if (message !== undefined) {
          dispatcher.dispatch(message);
        }
        // Nunca romper el webhook: responder 200 rápido y procesar en background.
        return reply.code(200).send({ ok: true });
      });
    });
}
