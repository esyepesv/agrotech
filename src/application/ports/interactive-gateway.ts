import type { InteractiveMessage } from '../../domain/message/reply-option.js';
import type { Result } from '../../domain/shared/result.js';
import type { ChannelError } from './channel-gateway.js';

/**
 * Puerto separado de `ChannelGateway` (ISP, arquitectura-v1.2.md §6): los
 * gateways de WhatsApp y Telegram lo implementan ADEMÁS del contrato de v1,
 * sin tocar `ChannelGateway` ni `OutgoingMessage`. Un canal que no lo
 * implemente sigue funcionando: el llamador consulta `supportsInteractive()`
 * y degrada a texto con `renderNumberedFallback`.
 */
export interface InteractiveGateway {
  supportsInteractive(): boolean;
  sendInteractive(message: InteractiveMessage): Promise<Result<void, ChannelError>>;

  /**
   * Higiene de teclados de Telegram (spec 001 §4.1.1): retira el spinner de
   * carga de un `callback_query` (API `answerCallbackQuery`). Opcional:
   * WhatsApp no tiene equivalente y no lo implementa (ISP).
   */
  answerCallback?(callbackQueryId: string): Promise<void>;

  /**
   * Edita `reply_markup` del mensaje a vacío para que un botón ya
   * respondido no quede re-pulsable ("clearKeyboard"). Opcional: WhatsApp
   * no puede retirar botones ya enviados — ahí la defensa es el id
   * namespaced (`reg:<campo>:<valor>`), no el borrado del teclado.
   */
  clearOptions?(chatId: string, messageId: number): Promise<void>;

  /**
   * Pide el celular por el botón nativo de "compartir contacto" (spec 001
   * §4.1.2): en Telegram el `channelUserId` (chat_id) NO es un teléfono, a
   * diferencia de WhatsApp, donde `channelUserId` YA es el celular en
   * E.164 y no hace falta pedir nada. Opcional: WhatsApp no lo implementa.
   */
  requestContact?(channelUserId: string, body: string): Promise<Result<void, ChannelError>>;
}
