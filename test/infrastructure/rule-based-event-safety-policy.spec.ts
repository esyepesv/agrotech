import { describe, expect, it } from 'vitest';
import type {
  FarmEventDraft,
  FeedDelivery,
  MedicationApplication,
} from '../../src/domain/farm/farm-event.js';
import { RuleBasedEventSafetyPolicy } from '../../src/infrastructure/safety/rule-based-event-safety-policy.js';

function draftOf(payload: FarmEventDraft['payload']): FarmEventDraft {
  return {
    payload,
    confidence: 0.9,
    camposFaltantes: [],
    rawTranscript: 'texto de prueba',
    source: 'text',
  };
}

describe('RuleBasedEventSafetyPolicy', () => {
  it('medicación aplicada → register_flagged (se registra sin validar dosis)', () => {
    const payload: MedicationApplication = {
      type: 'medication_application',
      chapeta: '214',
      product: 'oxitetraciclina',
      doseText: '5 ml',
      needsVetReview: true,
    };

    const decision = new RuleBasedEventSafetyPolicy().assessEvent(draftOf(payload));

    expect(decision.action).toBe('register_flagged');
    expect(decision.reason).toContain('sin validar dosis');
  });

  it('entrega de alimento → register (hecho productivo estándar)', () => {
    const payload: FeedDelivery = {
      type: 'feed_delivery',
      itemName: 'Solla',
      qty: 3,
      unit: 'bulto',
      targetKind: 'general',
    };

    const decision = new RuleBasedEventSafetyPolicy().assessEvent(draftOf(payload));

    expect(decision.action).toBe('register');
  });
});
