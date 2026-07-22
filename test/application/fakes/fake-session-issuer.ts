import type {
  SessionClaims,
  SessionError,
  SessionIssuer,
} from '../../../src/application/ports/session-issuer.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { err, ok } from '../../../src/domain/shared/result.js';

/**
 * Fake in-memory: codifica los claims en el propio token (JSON) para que
 * `verify()` los recupere sin criptografía real — suficiente para probar
 * casos de uso que dependen del puerto `SessionIssuer`. El JWT real (firma,
 * expiración, tamper) lo cubre `jwt-session-issuer.spec.ts`.
 */
export class FakeSessionIssuer implements SessionIssuer {
  readonly issued: { claims: SessionClaims; ttlSeconds: number }[] = [];
  private readonly revoked = new Set<string>();

  issue(claims: SessionClaims, ttlSeconds: number): string {
    this.issued.push({ claims, ttlSeconds });
    return JSON.stringify(claims);
  }

  verify(token: string): Result<SessionClaims, SessionError> {
    if (this.revoked.has(token)) {
      return err({ kind: 'invalid', message: 'token revocado (fake)' });
    }
    try {
      const claims = JSON.parse(token) as SessionClaims;
      return ok(claims);
    } catch {
      return err({ kind: 'invalid', message: 'token no parseable (fake)' });
    }
  }

  revoke(token: string): void {
    this.revoked.add(token);
  }
}
