import type { FarmEventDraft } from '../../../src/domain/farm/farm-event.js';
import type {
  EventSafetyDecision,
  EventSafetyPolicy,
} from '../../../src/application/ports/event-safety-policy.js';

export class FakeEventSafetyPolicy implements EventSafetyPolicy {
  decisionOverride?: EventSafetyDecision;

  assessEvent(draft: FarmEventDraft): EventSafetyDecision {
    if (this.decisionOverride) {
      return this.decisionOverride;
    }
    if (draft.payload.type === 'medication_application') {
      return {
        action: 'register_flagged',
        reason: 'aplicación de medicamento: se registra el hecho sin validar la dosis',
      };
    }
    return { action: 'register', reason: 'evento de manejo estándar' };
  }
}
