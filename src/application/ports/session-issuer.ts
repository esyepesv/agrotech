import type { Result } from '../../domain/shared/result.js';

export interface SessionClaims {
  readonly userId: string;
  readonly operatorId: string;
  readonly farmId: string;
  readonly role: string;
}

export interface SessionError {
  readonly kind: 'invalid' | 'expired';
  readonly message: string;
}

/**
 * Emisor/verificador de sesión web (arquitectura-v1.2.md §6/§8). Puerto
 * síncrono a propósito: `JwtSessionIssuer` calcula el HMAC con `node:crypto`
 * en vez de las funciones async de `jose` (que solo trabajan sobre
 * WebCrypto) — ver el comentario en esa clase.
 */
export interface SessionIssuer {
  issue(claims: SessionClaims, ttlSeconds: number): string;
  verify(token: string): Result<SessionClaims, SessionError>;
}
