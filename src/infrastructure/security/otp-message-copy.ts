// Copys compartidos de entrega de OTP por transporte. Centralizados aquí
// para no repetir el texto en cada sender y para que un cambio de tono no
// obligue a tocar la lógica de envío.

export function otpChatBody(code: string): string {
  return `Tu código de verificación de PorcIA es ${code}. Vence pronto, no lo compartas con nadie.`;
}

export function otpSmsBody(code: string): string {
  return `PorcIA: tu código de verificación es ${code}. No lo compartas.`;
}

export function otpEmailSubject(): string {
  return 'Tu código de verificación de PorcIA';
}

export function otpEmailText(code: string, ttlMinutes: number): string {
  return [
    'Hola,',
    '',
    `Tu código de verificación de PorcIA es: ${code}`,
    '',
    `Vence en ${String(ttlMinutes)} minutos.`,
    '',
    'Si no fuiste tú quien lo solicitó, ignora este mensaje.',
  ].join('\n');
}

// Paleta de marca (arquitectura-v1.2.md §10): teal, terracota, crema, ink.
const BRAND = { teal: '#1B4D3E', terracota: '#C86446', crema: '#F4EFEA', ink: '#2C3531' };

export function otpEmailHtml(code: string, ttlMinutes: number): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:${BRAND.crema};font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:${BRAND.teal};padding:20px 24px;">
          <span style="color:#ffffff;font-size:18px;font-weight:bold;">PorcIA</span>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 16px;">Hola,</p>
          <p style="margin:0 0 16px;">Tu código de verificación es:</p>
          <p style="margin:0 0 16px;font-size:32px;font-weight:bold;letter-spacing:4px;color:${BRAND.teal};">${code}</p>
          <p style="margin:0 0 16px;">Vence en ${String(ttlMinutes)} minutos.</p>
          <p style="margin:0;color:${BRAND.terracota};">Si no fuiste tú quien lo solicitó, ignora este mensaje.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
