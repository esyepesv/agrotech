import type { Channel } from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { ChannelGateway } from '../../application/ports/channel-gateway.js';
import type { OtpSendError, OtpTransportSender } from '../../application/ports/otp-sender.js';
import type { OtpTransport } from '../../application/ports/otp-store.js';
import { otpChatBody } from './otp-message-copy.js';

/**
 * Entrega el OTP como texto plano por WhatsApp o Telegram, reutilizando el
 * `ChannelGateway` ya cableado para cada canal (no duplica HTTP).
 *
 * LIMITACIÓN CONOCIDA (ya resuelta a nivel de producto, no de esta clase):
 * un bot de Telegram no puede escribirle a un chat con el que nunca ha
 * conversado, y WhatsApp exige una *authentication template* aprobada por
 * Meta para iniciar conversación fuera de la ventana de servicio de 24 h.
 * Este `ChannelOtpSender` de texto plano solo funciona en desarrollo o
 * cuando el usuario ya escribió al bot. Para un destino "frío" que nunca
 * escribió, `RoutingOtpSender` debe ofrecer `TwilioSmsSender`/
 * `SmtpEmailSender` en su lugar — por eso este archivo se mantiene simple
 * y no intenta resolver ese caso.
 */
export class ChannelOtpSender implements OtpTransportSender {
  readonly transport: OtpTransport;

  constructor(
    private readonly channel: Channel,
    private readonly resolveGateway: (channel: Channel) => ChannelGateway,
  ) {
    this.transport = channel;
  }

  isConfigured(): boolean {
    try {
      this.resolveGateway(this.channel);
      return true;
    } catch {
      return false;
    }
  }

  async send(destination: string, code: string): Promise<Result<void, OtpSendError>> {
    let gateway: ChannelGateway;
    try {
      gateway = this.resolveGateway(this.channel);
    } catch (error) {
      return err({ kind: 'channel_not_configured', message: describe(error) });
    }

    const message: OutgoingMessage = {
      channel: this.channel,
      channelUserId: destination,
      type: 'text',
      text: otpChatBody(code),
    };

    const result = await gateway.send(message);
    return result.ok ? ok(undefined) : err({ kind: 'send_failed', message: result.error.message });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido al resolver el canal';
}
