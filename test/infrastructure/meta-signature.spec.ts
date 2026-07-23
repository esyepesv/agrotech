import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from '../../src/infrastructure/security/meta-signature.js';

function sign(body: string | Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyMetaSignature', () => {
  const appSecret = 'test-app-secret-do-not-use-in-prod';
  const rawBody = JSON.stringify({ entry: [{ changes: [] }] });

  it('acepta una firma válida calculada sobre el mismo raw body (vector conocido)', () => {
    // Vector conocido: HMAC-SHA256('{"entry":[{"changes":[]}]}', appSecret).
    const expected = sign(rawBody, appSecret);
    expect(verifyMetaSignature(rawBody, expected, appSecret)).toBe(true);
  });

  it('funciona igual si el rawBody es un Buffer (bytes exactos, no re-serialización)', () => {
    const buf = Buffer.from(rawBody, 'utf8');
    expect(verifyMetaSignature(buf, sign(rawBody, appSecret), appSecret)).toBe(true);
  });

  it('rechaza si el body fue modificado tras firmarse', () => {
    const signatureOfOriginal = sign(rawBody, appSecret);
    const tampered = JSON.stringify({ entry: [{ changes: [], injected: true }] });
    expect(verifyMetaSignature(tampered, signatureOfOriginal, appSecret)).toBe(false);
  });

  it('rechaza si se firmó con un App Secret distinto', () => {
    expect(verifyMetaSignature(rawBody, sign(rawBody, 'otro-secreto'), appSecret)).toBe(false);
  });

  it('rechaza si falta el header de firma', () => {
    expect(verifyMetaSignature(rawBody, undefined, appSecret)).toBe(false);
  });

  it('rechaza un header sin el prefijo "sha256="', () => {
    const hexOnly = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    expect(verifyMetaSignature(rawBody, hexOnly, appSecret)).toBe(false);
  });

  it('rechaza un header con hex de longitud distinta a la esperada', () => {
    expect(verifyMetaSignature(rawBody, 'sha256=abcd', appSecret)).toBe(false);
  });
});
