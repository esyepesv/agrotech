import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isSelfSharedContact } from '../../domain/otp/telegram-contact.js';
import { normalizeTelegramContactPhone } from '../../domain/otp/otp-destination.js';
import type { IncomingMessage } from '../../domain/message/incoming-message.js';
import type { WebhookDispatcher } from './dispatcher.js';

const telegramUserSchema = z.object({ id: z.union([z.number(), z.string()]) });

const updateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({ id: z.union([z.number(), z.string()]) }),
      from: telegramUserSchema.optional(),
      text: z.string().optional(),
      voice: z.object({ file_id: z.string() }).optional(),
      audio: z.object({ file_id: z.string() }).optional(),
      // "Compartir mi número" (request_contact, spec 001 §4.1.2).
      contact: z
        .object({
          phone_number: z.string(),
          user_id: z.union([z.number(), z.string()]).optional(),
        })
        .optional(),
    })
    .optional(),
  // Botón/fila de lista tocados en un inline keyboard (spec 001 §4.1.1).
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      from: telegramUserSchema,
      message: z
        .object({
          message_id: z.number(),
          chat: z.object({ id: z.union([z.number(), z.string()]) }),
        })
        .optional(),
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
  if (!parsed.success) {
    return undefined;
  }

  const { callback_query: callbackQuery, message } = parsed.data;

  if (callbackQuery !== undefined && callbackQuery.data !== undefined) {
    return {
      channel: 'telegram',
      // Un callback pertenece al chat que contiene el teclado. Usar `from.id`
      // hacía que, fuera de un chat privado, se buscara otro hash distinto al
      // que guardó el borrador al recibir el mensaje inicial y el flujo se
      // reiniciara en la pregunta de rol.
      channelUserId: String(callbackQuery.message?.chat.id ?? callbackQuery.from.id),
      messageId: `tg:cb:${callbackQuery.id}`,
      type: 'text',
      text: callbackQuery.data,
      receivedAt: new Date(),
      callbackQueryId: callbackQuery.id,
      callbackMessageId: callbackQuery.message?.message_id,
    };
  }

  if (message === undefined) {
    return undefined;
  }

  const chatId = String(message.chat.id);
  const receivedAt = new Date();
  const messageId = `tg:${String(parsed.data.update_id)}`;

  if (message.contact !== undefined) {
    // Telegram permite reenviar el contacto de OTRA persona: solo cuenta
    // como celular verificado si `contact.user_id` es el propio remitente
    // (§4.1.2). `message.from` es quien envió el mensaje en un chat privado.
    const senderId = message.from !== undefined ? String(message.from.id) : chatId;
    const isSelf =
      message.contact.user_id !== undefined &&
      isSelfSharedContact(
        { phoneNumber: message.contact.phone_number, contactUserId: message.contact.user_id },
        senderId,
      );
    return {
      channel: 'telegram',
      channelUserId: chatId,
      messageId,
      type: 'text',
      text: 'contacto compartido',
      receivedAt,
      ...(isSelf
        ? { contactPhone: normalizeTelegramContactPhone(message.contact.phone_number) }
        : {}),
    };
  }

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
