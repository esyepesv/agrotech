import { describe, expect, it } from 'vitest';
import {
  normalizeDestination,
  normalizeTelegramContactPhone,
} from '../../../src/domain/otp/otp-destination.js';

describe('normalizeDestination', () => {
  it('celular colombiano de 10 dígitos sin indicativo → antepone +57', () => {
    expect(normalizeDestination('3001234567', 'phone')).toBe('+573001234567');
  });

  it('celular con espacios/guiones se limpia igual', () => {
    expect(normalizeDestination('300 123 4567', 'phone')).toBe('+573001234567');
    expect(normalizeDestination('300-123-4567', 'phone')).toBe('+573001234567');
  });

  it('celular que ya trae + se conserva (solo se limpia el ruido)', () => {
    expect(normalizeDestination('+57 300 123 4567', 'phone')).toBe('+573001234567');
  });

  it('correo se normaliza a minúsculas sin espacios', () => {
    expect(normalizeDestination('  Ana.Perez@Ejemplo.COM  ', 'email')).toBe(
      'ana.perez@ejemplo.com',
    );
  });
});

describe('normalizeTelegramContactPhone', () => {
  it('agrega + cuando Telegram lo entrega sin prefijo', () => {
    expect(normalizeTelegramContactPhone('573001234567')).toBe('+573001234567');
  });

  it('reutiliza la limpieza de normalizeDestination cuando ya trae +', () => {
    expect(normalizeTelegramContactPhone('+57 300 123 4567')).toBe('+573001234567');
  });
});
