import { err, ok, type Result } from '../../domain/shared/result.js';
import type { OtpSendError, OtpTransportSender } from '../../application/ports/otp-sender.js';
import type { OtpTransport } from '../../application/ports/otp-store.js';
import { resilientFetch } from '../http/resilient-fetch.js';
import { otpSmsBody } from './otp-message-copy.js';

export interface TwilioConfig {
  readonly accountSid: string;
  readonly authToken: string;
  readonly from?: string;
  readonly messagingServiceSid?: string;
}

/**
 * Envía el OTP por SMS con la API REST de Twilio (sin SDK: reutiliza
 * `resilientFetch`, igual que los gateways de chat). Es el transporte que
 * cubre un celular "frío" que nunca escribió al bot — el caso que
 * `ChannelOtpSender` documenta como fuera de su alcance.
 */
export class TwilioSmsSender implements OtpTransportSender {
  readonly transport: OtpTransport = 'sms';

  constructor(private readonly config: TwilioConfig) {}

  isConfigured(): boolean {
    return (
      this.config.accountSid.length > 0 &&
      this.config.authToken.length > 0 &&
      (this.config.messagingServiceSid !== undefined || this.config.from !== undefined)
    );
  }

  async send(destination: string, code: string): Promise<Result<void, OtpSendError>> {
    if (!this.isConfigured()) {
      return err({ kind: 'channel_not_configured', message: 'Twilio no configurado' });
    }

    const body = new URLSearchParams({ To: destination, Body: otpSmsBody(code) });
    if (this.config.messagingServiceSid !== undefined) {
      body.set('MessagingServiceSid', this.config.messagingServiceSid);
    } else if (this.config.from !== undefined) {
      body.set('From', this.config.from);
    }

    try {
      const response = await resilientFetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            // Basic auth con las credenciales de cuenta de Twilio; nunca se
            // loguea (ni aquí ni en el mensaje de error de abajo).
            authorization: `Basic ${basicAuth(this.config.accountSid, this.config.authToken)}`,
          },
          body: body.toString(),
        },
      );
      if (!response.ok) {
        return err({
          kind: 'send_failed',
          message: `Twilio Messages: HTTP ${String(response.status)}`,
        });
      }
      return ok(undefined);
    } catch (error) {
      return err({ kind: 'send_failed', message: describe(error) });
    }
  }
}

function basicAuth(accountSid: string, authToken: string): string {
  return Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en Twilio';
}
