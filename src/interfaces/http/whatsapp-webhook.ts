import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IncomingMessage } from '../../domain/message/incoming-message.js';
import type { WebhookDispatcher } from './dispatcher.js';

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

/**
 * Registra el webhook de WhatsApp (Fase 2): el GET de verificación de Meta
 * (reto hub.challenge) y el POST de mensajes entrantes. El controller
 * responde 200 rápido y nunca rompe frente al proveedor (sección 14).
 */
export function registerWhatsAppWebhook(
  app: FastifyInstance,
  dispatcher: WebhookDispatcher,
  verifyToken: string,
): void {
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
    const message = parseWhatsAppMessage(request.body);
    if (message !== undefined) {
      dispatcher.dispatch(message);
    }
    // Nunca romper el webhook: responder 200 rápido y procesar en background.
    return reply.code(200).send({ ok: true });
  });
}
