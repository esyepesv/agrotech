import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwilioSmsSender } from '../../src/infrastructure/security/twilio-sms-sender.js';

function jsonResponse(body: unknown, ok = true, status = 201): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TwilioSmsSender', () => {
  it('isConfigured es false sin credenciales', () => {
    const sender = new TwilioSmsSender({ accountSid: '', authToken: '' });
    expect(sender.isConfigured()).toBe(false);
  });

  it('isConfigured es true con accountSid+authToken+from', () => {
    const sender = new TwilioSmsSender({
      accountSid: 'AC123',
      authToken: 'secret',
      from: '+15005550006',
    });
    expect(sender.isConfigured()).toBe(true);
  });

  it('envía el SMS con Basic auth y el cuerpo del código', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sid: 'SM123' }));
    vi.stubGlobal('fetch', fetchMock);
    const sender = new TwilioSmsSender({
      accountSid: 'AC123',
      authToken: 'secret',
      from: '+15005550006',
    });

    const result = await sender.send('+573001234567', '123456');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(call[0]).toContain('/Accounts/AC123/Messages.json');
    expect(call[1].headers.authorization).toMatch(/^Basic /);
    const body = new URLSearchParams(call[1].body);
    expect(body.get('To')).toBe('+573001234567');
    expect(body.get('Body')).toContain('123456');
    expect(body.get('From')).toBe('+15005550006');
  });

  it('devuelve channel_not_configured sin intentar enviar si falta configuración', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const sender = new TwilioSmsSender({ accountSid: '', authToken: '' });

    const result = await sender.send('+573001234567', '123456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('channel_not_configured');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP no-ok de Twilio se mapea a send_failed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 400));
    vi.stubGlobal('fetch', fetchMock);
    const sender = new TwilioSmsSender({
      accountSid: 'AC123',
      authToken: 'secret',
      from: '+15005550006',
    });

    const result = await sender.send('+573001234567', '123456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('send_failed');
    }
  });
});
