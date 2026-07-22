import { err, type Result } from '../../domain/shared/result.js';
import type {
  OtpSendError,
  OtpSender,
  OtpTransportSender,
} from '../../application/ports/otp-sender.js';
import type { OtpTransport } from '../../application/ports/otp-store.js';

/**
 * Compone los `OtpTransportSender` disponibles (whatsapp/telegram/sms/
 * email) y enruta cada envío al que corresponda. No decide POR SÍ SOLO cuál
 * usar para un destino "frío": eso es responsabilidad de quien llama
 * `sendCode` (p. ej. el endpoint `request-otp`, que sabe qué canal eligió
 * el usuario). Este enrutador solo valida que el transporte pedido esté
 * registrado y configurado.
 */
export class RoutingOtpSender implements OtpSender {
  private readonly senders: ReadonlyMap<OtpTransport, OtpTransportSender>;

  constructor(transportSenders: readonly OtpTransportSender[]) {
    this.senders = new Map(transportSenders.map((sender) => [sender.transport, sender]));
  }

  availableTransports(): readonly OtpTransport[] {
    return [...this.senders.values()]
      .filter((sender) => sender.isConfigured())
      .map((sender) => sender.transport);
  }

  async sendCode(
    transport: OtpTransport,
    destination: string,
    code: string,
  ): Promise<Result<void, OtpSendError>> {
    const sender = this.senders.get(transport);
    if (sender === undefined) {
      return err({
        kind: 'channel_not_configured',
        message: `transporte no registrado: ${transport}`,
      });
    }
    if (!sender.isConfigured()) {
      return err({
        kind: 'channel_not_configured',
        message: `transporte no configurado: ${transport}`,
      });
    }
    return sender.send(destination, code);
  }
}
