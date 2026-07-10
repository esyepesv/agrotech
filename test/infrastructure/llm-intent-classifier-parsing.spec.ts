import { describe, expect, it } from 'vitest';
import { parseIntentJson } from '../../src/infrastructure/intent/llm-intent-classifier.js';

/**
 * Parseo puro (sin red): cubre JSON válido, JSON roto, kind desconocido y
 * confidence fuera de rango. La suite de integración real (con LLM_API_KEY)
 * vive en llm-intent-classifier.spec.ts.
 */
describe('parseIntentJson', () => {
  it('JSON válido con kind y confidence correctos → ok', () => {
    const result = parseIntentJson('{"kind": "log_event", "confidence": 0.82}');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: 'log_event', confidence: 0.82 });
    }
  });

  it('JSON roto (sintaxis inválida) → err invalid_output', () => {
    const result = parseIntentJson('{"kind": "log_event", confidence: }');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });

  it('kind fuera de la unión conocida → err invalid_output', () => {
    const result = parseIntentJson('{"kind": "chismecito", "confidence": 0.5}');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });

  it('confidence fuera de [0,1] → err invalid_output', () => {
    const result = parseIntentJson('{"kind": "question", "confidence": 1.5}');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });

  it('confidence negativo → err invalid_output', () => {
    const result = parseIntentJson('{"kind": "question", "confidence": -0.1}');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });

  it('JSON válido pero de forma distinta (falta confidence) → err invalid_output', () => {
    const result = parseIntentJson('{"kind": "question"}');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });
});
