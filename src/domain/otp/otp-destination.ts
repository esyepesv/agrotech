export type OtpDestinationKind = 'phone' | 'email';

/**
 * Normaliza un destino de OTP para usarlo como llave del `OtpStore`: celular
 * a E.164 o correo en minúsculas sin espacios. La llave es el DESTINO, no el
 * canal de entrega — un mismo celular verificado por WhatsApp, Telegram o
 * SMS es la misma prueba de posesión (arquitectura-v1.2.md §8).
 */
export function normalizeDestination(raw: string, kind: OtpDestinationKind): string {
  const trimmed = raw.trim();
  return kind === 'email' ? normalizeEmail(trimmed) : normalizePhone(trimmed);
}

/**
 * El `phone_number` que entrega Telegram al compartir contacto a veces llega
 * sin `+` (p. ej. "573001234567"). Reutiliza `normalizeDestination` tras
 * garantizar el prefijo, en vez de duplicar la lógica de limpieza de
 * dígitos (spec 001 §4.1.2).
 */
export function normalizeTelegramContactPhone(rawPhoneNumber: string): string {
  const trimmed = rawPhoneNumber.trim();
  const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  return normalizeDestination(withPlus, 'phone');
}

function normalizeEmail(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '');
}

function normalizePhone(raw: string): string {
  const digitsAndPlus = raw.replace(/[^\d+]/g, '');
  if (digitsAndPlus.startsWith('+')) {
    return digitsAndPlus;
  }
  // Celular colombiano de 10 dígitos empezando por 3 (spec 001 §4.2): sin
  // indicativo se asume +57.
  if (/^3\d{9}$/.test(digitsAndPlus)) {
    return `+57${digitsAndPlus}`;
  }
  return `+${digitsAndPlus}`;
}
