import { describe, expect, it } from 'vitest';
import { RoutingOtpSender } from '../../src/infrastructure/security/routing-otp-sender.js';
import type { OtpSendError, OtpTransportSender } from '../../src/application/ports/otp-sender.js';
import type { OtpTransport } from '../../src/application/ports/otp-store.js';
import { err, ok, type Result } from '../../src/domain/shared/result.js';

class StubSender implements OtpTransportSender {
  readonly calls: { destination: string; code: string }[] = [];

  constructor(
    readonly transport: OtpTransport,
    private readonly configured = true,
    private readonly result: Result<void, OtpSendError> = ok(undefined),
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  async send(destination: string, code: string): Promise<Result<void, OtpSendError>> {
    this.calls.push({ destination, code });
    return this.result;
  }
}

describe('RoutingOtpSender', () => {
  it('availableTransports solo incluye los transportes configurados', () => {
    const whatsapp = new StubSender('whatsapp', true);
    const email = new StubSender('email', false);
    const router = new RoutingOtpSender([whatsapp, email]);

    expect(router.availableTransports()).toEqual(['whatsapp']);
  });

  it('sendCode delega al transporte correspondiente', async () => {
    const sms = new StubSender('sms', true);
    const router = new RoutingOtpSender([sms]);

    const result = await router.sendCode('sms', '+573001234567', '123456');

    expect(result.ok).toBe(true);
    expect(sms.calls).toEqual([{ destination: '+573001234567', code: '123456' }]);
  });

  it('sendCode a un transporte no registrado devuelve channel_not_configured', async () => {
    const router = new RoutingOtpSender([]);

    const result = await router.sendCode('email', 'ana@ejemplo.com', '123456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('channel_not_configured');
    }
  });

  it('sendCode a un transporte registrado pero no configurado devuelve channel_not_configured sin llamar a send', async () => {
    const telegram = new StubSender('telegram', false);
    const router = new RoutingOtpSender([telegram]);

    const result = await router.sendCode('telegram', '999', '123456');

    expect(result.ok).toBe(false);
    expect(telegram.calls).toHaveLength(0);
  });

  it('propaga el error del transporte cuando send falla', async () => {
    const failing = new StubSender('sms', true, err({ kind: 'send_failed', message: 'boom' }));
    const router = new RoutingOtpSender([failing]);

    const result = await router.sendCode('sms', '+573001234567', '123456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('boom');
    }
  });
});
