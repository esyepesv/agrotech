import { describe, expect, it } from 'vitest';
import { JwtSessionIssuer } from '../../src/infrastructure/security/jwt-session-issuer.js';
import type { SessionClaims } from '../../src/application/ports/session-issuer.js';

const SECRET_A = 'secreto-de-prueba-de-al-menos-32-caracteres';
const SECRET_B = 'otro-secreto-completamente-distinto-tambien-largo';

const CLAIMS: SessionClaims = {
  userId: 'user-1',
  operatorId: 'operator-1',
  farmId: 'farm-1',
  role: 'administrador_dueno',
};

describe('JwtSessionIssuer', () => {
  it('rechaza un secreto de menos de 32 caracteres', () => {
    expect(() => new JwtSessionIssuer('corto')).toThrow();
  });

  it('round-trip: issue → verify devuelve los mismos claims', () => {
    const issuer = new JwtSessionIssuer(SECRET_A);
    const token = issuer.issue(CLAIMS, 3600);

    const result = issuer.verify(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(CLAIMS);
    }
  });

  it('token vencido (ttl negativo) → expired', () => {
    const issuer = new JwtSessionIssuer(SECRET_A);
    const token = issuer.issue(CLAIMS, -10);

    const result = issuer.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('expired');
    }
  });

  it('firma alterada → invalid', () => {
    const issuer = new JwtSessionIssuer(SECRET_A);
    const token = issuer.issue(CLAIMS, 3600);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -2)}zz`;

    const result = issuer.verify(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
    }
  });

  it('payload alterado (cambia un claim tras firmar) → invalid', () => {
    const issuer = new JwtSessionIssuer(SECRET_A);
    const token = issuer.issue(CLAIMS, 3600);
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...CLAIMS, role: 'admin' })).toString(
      'base64url',
    );

    const result = issuer.verify(`${header}.${forgedPayload}.${signature}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
    }
  });

  it('secreto distinto al verificar → invalid', () => {
    const issuer = new JwtSessionIssuer(SECRET_A);
    const token = issuer.issue(CLAIMS, 3600);

    const otherIssuer = new JwtSessionIssuer(SECRET_B);
    const result = otherIssuer.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
    }
  });

  it('token con formato inválido (no 3 partes) → invalid', () => {
    const issuer = new JwtSessionIssuer(SECRET_A);
    const result = issuer.verify('no-es-un-jwt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
    }
  });
});
