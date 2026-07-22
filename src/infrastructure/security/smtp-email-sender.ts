import nodemailer from 'nodemailer';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { OtpSendError, OtpTransportSender } from '../../application/ports/otp-sender.js';
import type { OtpTransport } from '../../application/ports/otp-store.js';
import { otpEmailHtml, otpEmailSubject, otpEmailText } from './otp-message-copy.js';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly from: string;
  /**
   * Minutos mostrados en el copy del correo — solo informativo: la
   * expiración real la controla `OtpStore`/`OTP_TTL_SECONDS`, este valor no
   * cambia cuándo vence el código, solo lo que dice el texto.
   */
  readonly ttlMinutes?: number;
}

/** Subconjunto mínimo de nodemailer's `Transporter` que esta clase necesita
 * — permite inyectar un doble de prueba sin depender del tipo completo
 * (generics `any` por defecto) del paquete. */
export interface MailSender {
  sendMail(options: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html: string;
  }): Promise<unknown>;
}

/**
 * Envía el OTP por correo con nodemailer. El transporte se puede inyectar
 * (segundo parámetro, para pruebas sin credenciales reales); en producción
 * se construye uno desde `config`.
 */
export class SmtpEmailSender implements OtpTransportSender {
  readonly transport: OtpTransport = 'email';
  private readonly mailer: MailSender;

  constructor(
    private readonly config: SmtpConfig,
    mailer?: MailSender,
  ) {
    // El `Transporter` real de nodemailer satisface `MailSender`
    // estructuralmente (expone `sendMail` con una firma compatible), así
    // que no hace falta cast: `MailSender` es solo el subconjunto que esta
    // clase necesita, para poder inyectar un doble de prueba sin depender
    // del tipo completo del paquete.
    this.mailer =
      mailer ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        auth: { user: config.user, pass: config.password },
      });
  }

  isConfigured(): boolean {
    return (
      this.config.host.length > 0 && this.config.user.length > 0 && this.config.password.length > 0
    );
  }

  async send(destination: string, code: string): Promise<Result<void, OtpSendError>> {
    if (!this.isConfigured()) {
      return err({ kind: 'channel_not_configured', message: 'SMTP no configurado' });
    }

    const ttlMinutes = this.config.ttlMinutes ?? 5;
    try {
      await this.mailer.sendMail({
        from: this.config.from,
        to: destination,
        subject: otpEmailSubject(),
        text: otpEmailText(code, ttlMinutes),
        html: otpEmailHtml(code, ttlMinutes),
      });
      return ok(undefined);
    } catch (error) {
      return err({ kind: 'send_failed', message: describe(error) });
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en SMTP';
}
