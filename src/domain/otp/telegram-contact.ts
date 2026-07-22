export interface TelegramContactShare {
  readonly phoneNumber: string;
  readonly contactUserId: string | number;
}

/**
 * Telegram permite reenviar el contacto de OTRA persona al pulsar
 * "compartir contacto" (no solo el propio): el `phone_number` que llega en
 * ese caso NO prueba posesión de quien escribe. Solo si `contact.user_id`
 * coincide con el remitente del mensaje se puede dar el celular por
 * verificado por posesión de canal (spec 001 §4.1.2). Quien parsea el
 * webhook (fuera de este módulo) debe llamar esta función antes de aceptar
 * el `phone_number` como identidad verificada.
 */
export function isSelfSharedContact(
  contact: TelegramContactShare,
  senderChannelUserId: string,
): boolean {
  return String(contact.contactUserId) === senderChannelUserId;
}
