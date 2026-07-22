import { createHmac, timingSafeEqual } from 'node:crypto';
import { base64url } from 'jose';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type {
  SessionClaims,
  SessionError,
  SessionIssuer,
} from '../../application/ports/session-issuer.js';

const ALG = 'HS256';
const TYPE = 'JWT';
const ISSUER = 'porcia';

interface JwtHeader {
  readonly alg: typeof ALG;
  readonly typ: typeof TYPE;
}

interface JwtPayload {
  readonly userId: unknown;
  readonly operatorId: unknown;
  readonly farmId: unknown;
  readonly role: unknown;
  readonly iss: unknown;
  readonly iat: unknown;
  readonly exp: unknown;
}

/**
 * Emisor/verificador de sesión JWT HS256 (arquitectura-v1.2.md §6/§8). El
 * puerto `SessionIssuer` es síncrono a propósito, pero `jose` v6 firma y
 * verifica siempre de forma asíncrona (usa exclusivamente WebCrypto
 * internamente — no hay variante síncrona de `SignJWT`/`jwtVerify`, ver
 * `cryptoRuntime` del paquete). Por eso el HMAC se calcula con
 * `node:crypto` (síncrono) y de `jose` solo se reutiliza el codec
 * `base64url` (que sí es síncrono): el resultado es igual un JWT compacto
 * estándar (RFC 7519) verificable por cualquier librería JWT, no solo por
 * esta clase.
 */
export class JwtSessionIssuer implements SessionIssuer {
  constructor(private readonly secret: string) {
    if (secret.length < 32) {
      throw new Error('JwtSessionIssuer requiere un secreto de al menos 32 caracteres');
    }
  }

  issue(claims: SessionClaims, ttlSeconds: number): string {
    const now = Math.floor(Date.now() / 1000);
    const header: JwtHeader = { alg: ALG, typ: TYPE };
    const payload: JwtPayload = {
      ...claims,
      iss: ISSUER,
      iat: now,
      exp: now + ttlSeconds,
    };

    const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
    return `${signingInput}.${this.sign(signingInput)}`;
  }

  verify(token: string): Result<SessionClaims, SessionError> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return err({ kind: 'invalid', message: 'formato de token inválido' });
    }
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
    const signingInput = `${headerB64}.${payloadB64}`;

    if (!this.hasValidSignature(signingInput, signatureB64)) {
      return err({ kind: 'invalid', message: 'firma inválida' });
    }

    let payload: JwtPayload;
    try {
      payload = JSON.parse(
        Buffer.from(base64url.decode(payloadB64)).toString('utf8'),
      ) as JwtPayload;
    } catch {
      return err({ kind: 'invalid', message: 'payload no parseable' });
    }

    if (payload.iss !== ISSUER) {
      return err({ kind: 'invalid', message: 'issuer inesperado' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < now) {
      return err({ kind: 'expired', message: 'token vencido' });
    }

    const claims = extractClaims(payload);
    if (claims === undefined) {
      return err({ kind: 'invalid', message: 'claims incompletos' });
    }
    return ok(claims);
  }

  private hasValidSignature(signingInput: string, signatureB64: string): boolean {
    let expected: Buffer;
    let actual: Buffer;
    try {
      expected = Buffer.from(this.sign(signingInput));
      actual = Buffer.from(signatureB64);
    } catch {
      return false;
    }
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private sign(signingInput: string): string {
    const digest = createHmac('sha256', this.secret).update(signingInput).digest();
    return base64url.encode(digest);
  }
}

function encodeJson(value: unknown): string {
  return base64url.encode(JSON.stringify(value));
}

function extractClaims(payload: JwtPayload): SessionClaims | undefined {
  const { userId, operatorId, farmId, role } = payload;
  if (
    typeof userId !== 'string' ||
    typeof operatorId !== 'string' ||
    typeof farmId !== 'string' ||
    typeof role !== 'string'
  ) {
    return undefined;
  }
  return { userId, operatorId, farmId, role };
}
