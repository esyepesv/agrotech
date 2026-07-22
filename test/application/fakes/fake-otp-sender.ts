import type { OtpSendError, OtpSender } from '../../../src/application/ports/otp-sender.js';
import type { OtpTransport } from '../../../src/application/ports/otp-store.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';

export interface SentOtp {
  readonly transport: OtpTransport;
  readonly destination: string;
  readonly code: string;
}

export class FakeOtpSender implements OtpSender {
  readonly sent: SentOtp[] = [];

  constructor(
    private readonly transports: readonly OtpTransport[] = ['whatsapp', 'telegram', 'sms', 'email'],
    private readonly result: Result<void, OtpSendError> = ok(undefined),
  ) {}

  availableTransports(): readonly OtpTransport[] {
    return this.transports;
  }

  async sendCode(
    transport: OtpTransport,
    destination: string,
    code: string,
  ): Promise<Result<void, OtpSendError>> {
    this.sent.push({ transport, destination, code });
    return this.result;
  }
}
