import { normalizeColombianMobileToE164 } from '../farm/registration.js';
import type { Channel } from './incoming-message.js';

/**
 * Única fuente de la cadena que se hashea para identificar un chat.
 *
 * Existe porque el id que entrega cada canal NO es comparable con el celular
 * que la persona registró: el `wa_id` de WhatsApp llega sin `+`
 * ("573001234567") mientras el registro guarda E.164 ("+573001234567"), y el
 * id de Telegram no es un teléfono en absoluto. Hashear el id crudo hacía que
 * nadie volviera a ser reconocido tras registrarse.
 *
 * WhatsApp normaliza a E.164 (el id ES el celular). Telegram va prefijado
 * para que su espacio de ids numéricos no pueda colisionar con un celular.
 */
export function channelIdentityValue(channel: Channel, channelUserId: string): string {
  if (channel === 'telegram') {
    return `tg:${channelUserId}`;
  }
  return normalizeColombianMobileToE164(channelUserId) ?? channelUserId;
}
