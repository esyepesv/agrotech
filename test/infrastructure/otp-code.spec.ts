import { describe, expect, it } from 'vitest';
import { generateOtpCode, hashOtpCode } from '../../src/infrastructure/security/otp-code.js';

describe('generateOtpCode', () => {
  it('genera siempre 6 dígitos (incluso con ceros a la izquierda)', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashOtpCode', () => {
  it('es determinista con el mismo pepper', () => {
    const pepperA = 'pepper-de-prueba-1234567890ab';
    expect(hashOtpCode('123456', pepperA)).toBe(hashOtpCode('123456', pepperA));
  });

  it('produce un hash distinto con un pepper distinto', () => {
    const pepperA = 'pepper-de-prueba-1234567890ab';
    const pepperB = 'otro-pepper-completamente-distinto';
    expect(hashOtpCode('123456', pepperA)).not.toBe(hashOtpCode('123456', pepperB));
  });

  it('el código en claro no aparece dentro del hash', () => {
    const hash = hashOtpCode('123456', 'pepper-de-prueba-1234567890ab');
    expect(hash).not.toContain('123456');
  });

  it('es un hex de 64 caracteres (SHA-256)', () => {
    const hash = hashOtpCode('000000', 'pepper-de-prueba-1234567890ab');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
