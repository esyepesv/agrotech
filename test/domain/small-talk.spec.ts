import { describe, expect, it } from 'vitest';
import { classifySmallTalk } from '../../src/domain/query/small-talk.js';

describe('classifySmallTalk', () => {
  it('detecta saludos simples (con signos, tildes y mayúsculas)', () => {
    for (const s of ['Hola', '¿Hola?', 'hola!!', 'Buenas', 'Buenos días', 'qué más pues', 'Hey']) {
      expect(classifySmallTalk(s), s).toBe('greeting');
    }
  });

  it('detecta agradecimientos', () => {
    for (const s of ['Gracias', 'muchas gracias', 'Mil gracias 🐷']) {
      expect(classifySmallTalk(s), s).toBe('thanks');
    }
  });

  it('NO clasifica preguntas reales como small talk', () => {
    for (const s of [
      '¿Cada cuánto se le da concentrado?',
      'hola cuanto concentrado le doy',
      '¿cómo alimento una hembra lactante?',
      'buenas, qué dosis de antibiótico uso',
    ]) {
      expect(classifySmallTalk(s), s).toBeUndefined();
    }
  });

  it('devuelve undefined para texto vacío', () => {
    expect(classifySmallTalk('   ')).toBeUndefined();
  });
});
