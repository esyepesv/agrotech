export type Channel = 'telegram' | 'whatsapp';

export type Locale = 'es-CO' | 'es' | 'en';

export type MessageType = 'text' | 'voice';

export interface AudioReference {
  readonly channel: Channel;
  readonly mediaId: string;
}

export interface AudioClip {
  readonly data: Uint8Array;
  readonly mimeType: string;
}

export interface IncomingMessage {
  readonly channel: Channel;
  readonly channelUserId: string;
  readonly messageId: string;
  readonly type: MessageType;
  readonly text?: string;
  readonly audioRef?: AudioReference;
  readonly receivedAt: Date;
  // Telegram callback_query (botón/fila de lista tocada, spec 001 §4.1.1
  // "higiene de teclados"): permite responder `answerCallbackQuery` y
  // limpiar el teclado del mensaje que originó el tap. undefined en el resto.
  readonly callbackQueryId?: string;
  readonly callbackMessageId?: number;
  // Celular ya verificado por la propia plataforma vía "compartir contacto"
  // (spec 001 §4.1.2), solo si `contact.user_id` coincide con el remitente
  // (si no, el webhook no lo llena — nunca se da por verificado a ciegas).
  readonly contactPhone?: string;
}
