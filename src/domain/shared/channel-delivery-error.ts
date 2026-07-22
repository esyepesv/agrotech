import type { Channel } from '../message/incoming-message.js';

/**
 * Señala que el envío final del mensaje al canal (Telegram/WhatsApp) falló
 * (p. ej. un token de WhatsApp expirado). AnswerQuery.handle() lo lanza tras
 * registrar igual el turno en ConversationLog, para que el `.catch` del
 * dispatcher/runtime (que ya loguea con messageId y channel) deje constancia
 * del fallo en vez de tragárselo en silencio.
 */
export class ChannelDeliveryError extends Error {
  constructor(
    readonly channel: Channel,
    readonly reason: string,
  ) {
    super(`fallo al entregar mensaje por ${channel}: ${reason}`);
    this.name = 'ChannelDeliveryError';
  }
}
