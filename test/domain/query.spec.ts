import { describe, expect, it } from 'vitest';
import { createQuery } from '../../src/domain/query/query.js';

describe('createQuery', () => {
  it('normaliza espacios y recorta extremos', () => {
    const query = createQuery('  ¿qué hago   con una hembra\nen días abiertos?  ');
    expect(query.text).toBe('¿qué hago con una hembra en días abiertos?');
  });

  it('usa es-CO como locale por defecto', () => {
    expect(createQuery('hola').locale).toBe('es-CO');
  });

  it('respeta el locale explícito', () => {
    expect(createQuery('hola', 'es').locale).toBe('es');
  });
});
