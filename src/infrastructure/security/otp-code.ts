import { createHmac, randomInt } from 'node:crypto';

/**
 * Código OTP de 6 dígitos con `crypto.randomInt` (nunca `Math.random`,
 * que no es criptográficamente seguro). Puede empezar con ceros
 * ("007123"): se rellena con `padStart` para mantener siempre 6 dígitos.
 */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * HMAC-SHA256 del código con un pepper secreto — mismo patrón que
 * `hashUserId` (user-id-hash.ts). El código en claro nunca se persiste ni
 * se loguea; solo este hash llega a `OtpStore.saveCode`.
 */
export function hashOtpCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}
