import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../../src/infrastructure/llm/json-output.js';

describe('extractJsonObject', () => {
  it('devuelve el JSON tal cual cuando ya viene limpio', () => {
    expect(extractJsonObject('{"kind":"question","confidence":0.9}')).toBe(
      '{"kind":"question","confidence":0.9}',
    );
  });

  it('quita el bloque de código markdown ```json ... ``` (Claude vía OpenRouter)', () => {
    const raw = '```json\n{"kind": "log_event", "confidence": 0.95}\n```';
    expect(JSON.parse(extractJsonObject(raw))).toEqual({ kind: 'log_event', confidence: 0.95 });
  });

  it('quita un fence sin etiqueta de lenguaje', () => {
    const raw = '```\n{"a":1}\n```';
    expect(extractJsonObject(raw)).toBe('{"a":1}');
  });

  it('recorta texto antes y después del objeto', () => {
    const raw = 'Claro, aquí tienes: {"a":1} — listo.';
    expect(extractJsonObject(raw)).toBe('{"a":1}');
  });

  it('conserva objetos anidados (usa la última llave de cierre)', () => {
    const raw = '```json\n{"payload":{"type":"feed_delivery"},"confidence":0.8}\n```';
    expect(JSON.parse(extractJsonObject(raw))).toEqual({
      payload: { type: 'feed_delivery' },
      confidence: 0.8,
    });
  });

  it('sin llaves devuelve el texto tal cual (JSON.parse fallará explícitamente río abajo)', () => {
    expect(extractJsonObject('no hay json aquí')).toBe('no hay json aquí');
  });
});
