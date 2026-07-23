import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok } from '../../src/domain/shared/result.js';

describe('Result', () => {
  it('ok envuelve un valor y es identificable', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('err envuelve un error y es identificable', () => {
    const result = err({ kind: 'network' });
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ kind: 'network' });
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
  });

  it('discrimina el union por la propiedad ok', () => {
    const results = [ok('a'), err('boom')];
    const values = results.filter(isOk).map((r) => r.value);
    expect(values).toEqual(['a']);
  });
});
