import { describe, expect, it } from 'vitest';
import { parseShortReply } from '../../../src/domain/intent/short-reply.js';

describe('parseShortReply', () => {
  it('reconoce confirmaciones típicas con mayúsculas, tildes y puntuación', () => {
    expect(parseShortReply('Sí!')).toBe('confirm');
    expect(parseShortReply('DALE')).toBe('confirm');
    expect(parseShortReply('  ok  ')).toBe('confirm');
    expect(parseShortReply('Confirmo.')).toBe('confirm');
    expect(parseShortReply('de una')).toBe('confirm');
  });

  it('reconoce cancelaciones típicas con mayúsculas, tildes y puntuación', () => {
    expect(parseShortReply('No.')).toBe('cancel');
    expect(parseShortReply('después')).toBe('cancel');
    expect(parseShortReply('Cancela eso')).toBeUndefined(); // no es frase exacta reconocida
    expect(parseShortReply('CANCELAR')).toBe('cancel');
    expect(parseShortReply('ahora no')).toBe('cancel');
  });

  it('un texto largo devuelve undefined aunque contenga una palabra clave', () => {
    expect(
      parseShortReply('sí, pero espera, primero dime cuánto tengo de concentrado disponible'),
    ).toBeUndefined();
  });

  it('un texto no relacionado devuelve undefined', () => {
    expect(parseShortReply('cuánto me queda de Solla')).toBeUndefined();
    expect(parseShortReply('la cerda 214 no come')).toBeUndefined();
  });
});
