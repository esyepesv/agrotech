import nodemailer from 'nodemailer';
import type { LeadNotifier } from '../../application/ports/lead-notifier.js';
import type { Lead } from '../../application/ports/lead-store.js';
import type { MailSender, SmtpConfig } from './smtp-email-sender.js';

export class SmtpLeadNotifier implements LeadNotifier {
  private readonly mailer: MailSender | undefined;

  constructor(
    private readonly config: SmtpConfig | undefined,
    private readonly recipient: string,
    mailer?: MailSender,
  ) {
    this.mailer =
      mailer ??
      (config === undefined
        ? undefined
        : nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.port === 465,
            auth: { user: config.user, pass: config.password },
          }));
  }

  async notify(lead: Lead): Promise<boolean> {
    if (this.config === undefined || this.mailer === undefined) return false;
    const details = [
      `Tipo: ${lead.type === 'pilot' ? 'Piloto' : 'Aliado/inversionista'}`,
      `Nombre: ${lead.name}`,
      lead.whatsapp === undefined ? undefined : `WhatsApp: ${lead.whatsapp}`,
      lead.email === undefined ? undefined : `Correo: ${lead.email}`,
      lead.organization === undefined ? undefined : `Organización: ${lead.organization}`,
      lead.farmDetails === undefined ? undefined : `Granja: ${lead.farmDetails}`,
      lead.interestedInManagement === undefined ? undefined : `Interés en gestión: ${lead.interestedInManagement ? 'sí' : 'no'}`,
      lead.message === undefined ? undefined : `Mensaje: ${lead.message}`,
    ].filter((line): line is string => line !== undefined);
    try {
      await this.mailer.sendMail({
        from: this.config.from,
        to: this.recipient,
        subject: `[PorcIA] Nuevo contacto: ${lead.type === 'pilot' ? 'piloto' : 'aliado'}`,
        text: details.join('\n'),
        html: `<pre style="font:14px/1.5 sans-serif">${escapeHtml(details.join('\n'))}</pre>`,
      });
      return true;
    } catch {
      return false;
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}
