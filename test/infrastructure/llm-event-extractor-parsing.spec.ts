import { describe, expect, it } from 'vitest';
import { parseDraftJson } from '../../src/infrastructure/extraction/llm-event-extractor.js';

/**
 * Parseo puro (sin red): cubre JSON válido completo, JSON roto, tipo de
 * evento desconocido y payload con campos requeridos ausentes (→
 * camposFaltantes, nunca inventados). La suite de integración real (con
 * LLM_API_KEY) vive en llm-event-extractor.spec.ts.
 */
describe('parseDraftJson', () => {
  it('JSON completo de feed_delivery → ok, sin campos faltantes', () => {
    const raw = JSON.stringify({
      payload: {
        type: 'feed_delivery',
        itemName: 'Solla',
        qty: 3,
        unit: 'bulto',
        targetKind: 'general',
      },
      confidence: 0.95,
      camposFaltantes: [],
    });

    const result = parseDraftJson(raw, 'text', 'hoy le di 3 bultos de solla a la ceba');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload).toEqual({
        type: 'feed_delivery',
        itemName: 'Solla',
        qty: 3,
        unit: 'bulto',
        targetKind: 'general',
        lotId: undefined,
        sowChapeta: undefined,
        penNumber: undefined,
      });
      expect(result.value.camposFaltantes).toEqual([]);
      expect(result.value.confidence).toBe(0.95);
      expect(result.value.source).toBe('text');
      expect(result.value.rawTranscript).toBe('hoy le di 3 bultos de solla a la ceba');
    }
  });

  it('inventory_purchase con unitCost → ok', () => {
    const raw = JSON.stringify({
      payload: {
        type: 'inventory_purchase',
        itemName: 'Italcol',
        kind: 'concentrado',
        qty: 10,
        unit: 'bulto',
        unitCost: 95000,
      },
      confidence: 0.9,
      camposFaltantes: [],
    });

    const result = parseDraftJson(raw, 'text', 'compré 10 bultos de italcol a 95 mil');

    expect(result.ok).toBe(true);
    if (result.ok && result.value.payload.type === 'inventory_purchase') {
      expect(result.value.payload.unitCost).toBe(95000);
      expect(result.value.payload.qty).toBe(10);
    }
  });

  it('JSON roto (sintaxis inválida) → err invalid_output', () => {
    const result = parseDraftJson('{"payload": {', 'text', 'texto cualquiera');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });

  it('tipo de evento desconocido → err unrecognized_event', () => {
    const raw = JSON.stringify({
      payload: { type: 'evento_inventado' },
      confidence: 0.5,
      camposFaltantes: [],
    });

    const result = parseDraftJson(raw, 'text', 'texto cualquiera');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unrecognized_event');
    }
  });

  it('confidence fuera de [0,1] → err invalid_output', () => {
    const raw = JSON.stringify({
      payload: { type: 'heat_confirmation', chapeta: '214' },
      confidence: 2,
      camposFaltantes: [],
    });

    const result = parseDraftJson(raw, 'voice', 'la 214 entró en celo');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });

  it('payload sin campos requeridos (qty/unit ausentes) → ok con camposFaltantes, sin inventar valores', () => {
    const raw = JSON.stringify({
      payload: { type: 'feed_delivery', itemName: 'Solla', targetKind: 'general' },
      confidence: 0.4,
      camposFaltantes: [],
    });

    const result = parseDraftJson(raw, 'text', 'le di solla a la ceba');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.camposFaltantes).toEqual(expect.arrayContaining(['cantidad', 'unidad']));
    }
  });

  it('el modelo ya declara camposFaltantes y se respeta (unión sin duplicados)', () => {
    const raw = JSON.stringify({
      payload: { type: 'weight_control' },
      confidence: 0.3,
      camposFaltantes: ['peso promedio'],
    });

    const result = parseDraftJson(raw, 'text', 'pesé el lote');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.camposFaltantes).toEqual(['peso promedio']);
    }
  });

  it('medication_application siempre fija needsVetReview=true (regla dura, no viene del modelo)', () => {
    const raw = JSON.stringify({
      payload: {
        type: 'medication_application',
        chapeta: '214',
        product: 'oxitetraciclina',
        doseText: '5 ml',
      },
      confidence: 0.9,
      camposFaltantes: [],
    });

    const result = parseDraftJson(raw, 'voice', 'le apliqué 5 ml de oxitetraciclina a la 214');

    expect(result.ok).toBe(true);
    if (result.ok && result.value.payload.type === 'medication_application') {
      expect(result.value.payload.needsVetReview).toBe(true);
    }
  });

  it('estructura de respuesta inválida (falta payload) → err invalid_output', () => {
    const raw = JSON.stringify({ confidence: 0.5, camposFaltantes: [] });

    const result = parseDraftJson(raw, 'text', 'texto cualquiera');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });
});
