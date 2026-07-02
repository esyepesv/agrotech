import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IncomingMessage } from '../../domain/message/incoming-message.js';
import type { WebhookDispatcher } from './dispatcher.js';

const updateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({ id: z.union([z.number(), z.string()]) }),
      text: z.string().optional(),
      voice: z.object({ file_id: z.string() }).optional(),
      audio: z.object({ file_id: z.string() }).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof updateSchema>;

/**
 * Traduce un update de Telegram a IncomingMessage del dominio.
 * Función pura: no toca red ni estado, testeable sin credenciales.
 */
export function parseTelegramUpdate(body: unknown): IncomingMessage | undefined {
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success || parsed.data.message === undefined) {
    return undefined;
  }

  const { message } = parsed.data;
  const chatId = String(message.chat.id);
  const receivedAt = new Date();
  const messageId = `tg:${String(parsed.data.update_id)}`;
  const voiceFileId = message.voice?.file_id ?? message.audio?.file_id;

  if (voiceFileId !== undefined) {
    return {
      channel: 'telegram',
      channelUserId: chatId,
      messageId,
      type: 'voice',
      audioRef: { channel: 'telegram', mediaId: voiceFileId },
      receivedAt,
    };
  }

  if (message.text !== undefined && message.text.trim().length > 0) {
    return {
      channel: 'telegram',
      channelUserId: chatId,
      messageId,
      type: 'text',
      text: message.text,
      receivedAt,
    };
  }

  return undefined;
}

export function registerTelegramWebhook(app: FastifyInstance, dispatcher: WebhookDispatcher): void {
  app.post('/webhook/telegram', (request, reply) => {
    const message = parseTelegramUpdate(request.body);
    if (message !== undefined) {
      dispatcher.dispatch(message);
    }
    // Nunca romper el webhook: responder 200 rápido y procesar en background.
    return reply.code(200).send({ ok: true });
  });
}
