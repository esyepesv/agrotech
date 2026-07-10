import { describe, expect, it } from 'vitest';
import type {
  Farrowing,
  FarmEventDraft,
  FeedDelivery,
  InventoryPurchase,
  MedicationApplication,
} from '../../../src/domain/farm/farm-event.js';
import { describeDraft, isDraftComplete } from '../../../src/domain/farm/farm-event.js';

function draftOf(payload: FarmEventDraft['payload'], camposFaltantes: string[] = []): FarmEventDraft {
  return {
    payload,
    confidence: 0.9,
    camposFaltantes,
    rawTranscript: 'texto de prueba',
    source: 'voice',
  };
}

describe('describeDraft', () => {
  it('describe una entrega de alimento a un lote en un corral', () => {
    const payload: FeedDelivery = {
      type: 'feed_delivery',
      itemName: 'Solla',
      qty: 3,
      unit: 'bulto',
      targetKind: 'lot',
      penNumber: 4,
    };
    expect(describeDraft(draftOf(payload))).toBe('3 bulto de Solla a la ceba del corral 4');
  });

  it('describe una compra de inventario con marca y costo', () => {
    const payload: InventoryPurchase = {
      type: 'inventory_purchase',
      itemName: 'Solla',
      kind: 'concentrado',
      qty: 10,
      unit: 'bulto',
      unitCost: 85000,
      brand: 'Solla',
    };
    expect(describeDraft(draftOf(payload))).toBe(
      'Compra de 10 bulto de Solla marca Solla a $85000 c/u',
    );
  });

  it('describe un parto con conteo de vivos y muertos', () => {
    const payload: Farrowing = {
      type: 'farrowing',
      chapeta: '214',
      bornAlive: 11,
      bornDead: 1,
    };
    expect(describeDraft(draftOf(payload))).toBe(
      'Parto de la cerda 214, 11 nacidos vivos, 1 muertos',
    );
  });

  it('describe una aplicación de medicamento sin validar la dosis', () => {
    const payload: MedicationApplication = {
      type: 'medication_application',
      chapeta: '214',
      product: 'oxitetraciclina',
      doseText: '5 ml',
      needsVetReview: true,
    };
    expect(describeDraft(draftOf(payload))).toBe(
      'Aplicación de oxitetraciclina de la cerda 214 (5 ml)',
    );
  });
});

describe('isDraftComplete', () => {
  it('es true cuando no faltan campos', () => {
    const payload: FeedDelivery = {
      type: 'feed_delivery',
      itemName: 'Solla',
      qty: 3,
      unit: 'bulto',
      targetKind: 'general',
    };
    expect(isDraftComplete(draftOf(payload))).toBe(true);
  });

  it('es false cuando hay campos faltantes', () => {
    const payload: FeedDelivery = {
      type: 'feed_delivery',
      itemName: 'Solla',
      qty: 3,
      unit: 'bulto',
      targetKind: 'general',
    };
    expect(isDraftComplete(draftOf(payload, ['penNumber']))).toBe(false);
  });
});
