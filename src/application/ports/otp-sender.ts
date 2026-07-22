import type { Result } from '../../domain/shared/result.js';
import type { OtpTransport } from './otp-store.js';

export interface OtpSendError {
  readonly kind: 'send_failed' | 'channel_not_configured';
  readonly message: string;
}

/**
 * Un transporte concreto de entrega (whatsapp/telegram/sms/email). Nunca
 * genera ni valida códigos: solo entrega uno ya generado por el motor de
 * OTP (`otp-code.ts` + `OtpStore`), que es el único punto de verdad para
 * TTL/intentos sin importar por dónde se envió.
 */
export interface OtpTransportSender {
  readonly transport: OtpTransport;
  isConfigured(): boolean;
  send(destination: string, code: string): Promise<Result<void, OtpSendError>>;
}

/**
 * Enruta el envío al `OtpTransportSender` correspondiente. `RoutingOtpSender`
 * (infra/security) es la implementación real: se compone de los
 * transportes disponibles según credenciales configuradas.
 */
export interface OtpSender {
  availableTransports(): readonly OtpTransport[];
  sendCode(
    transport: OtpTransport,
    destination: string,
    code: string,
  ): Promise<Result<void, OtpSendError>>;
}
