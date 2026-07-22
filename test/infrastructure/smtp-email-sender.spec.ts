import { describe, expect, it, vi } from 'vitest';
import {
  SmtpEmailSender,
  type MailSender,
} from '../../src/infrastructure/security/smtp-email-sender.js';

function fakeMailer(sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' })): MailSender {
  return { sendMail };
}

describe('SmtpEmailSender', () => {
  it('isConfigured es false sin credenciales', () => {
    const sender = new SmtpEmailSender(
      { host: '', port: 587, user: '', password: '', from: 'no-reply@porcia.com.co' },
      fakeMailer(),
    );
    expect(sender.isConfigured()).toBe(false);
  });

  it('envía el correo con subject/text/html incluyendo el código', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const sender = new SmtpEmailSender(
      {
        host: 'smtp.example.com',
        port: 587,
        user: 'user',
        password: 'pass',
        from: 'no-reply@porcia.com.co',
      },
      fakeMailer(sendMail),
    );

    const result = await sender.send('ana@ejemplo.com', '123456');

    expect(result.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const callArgs = sendMail.mock.calls[0] as [
      { from: string; to: string; subject: string; text: string; html: string },
    ];
    const options = callArgs[0];
    expect(options.to).toBe('ana@ejemplo.com');
    expect(options.from).toBe('no-reply@porcia.com.co');
    expect(options.text).toContain('123456');
    expect(options.html).toContain('123456');
  });

  it('devuelve channel_not_configured sin intentar enviar si falta configuración', async () => {
    const sendMail = vi.fn();
    const sender = new SmtpEmailSender(
      { host: '', port: 587, user: '', password: '', from: 'no-reply@porcia.com.co' },
      fakeMailer(sendMail),
    );

    const result = await sender.send('ana@ejemplo.com', '123456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('channel_not_configured');
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('un error del transporte se mapea a send_failed', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('SMTP connection refused'));
    const sender = new SmtpEmailSender(
      {
        host: 'smtp.example.com',
        port: 587,
        user: 'user',
        password: 'pass',
        from: 'no-reply@porcia.com.co',
      },
      fakeMailer(sendMail),
    );

    const result = await sender.send('ana@ejemplo.com', '123456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('send_failed');
    }
  });
});
