import type { FarmEventDraft } from '../../domain/farm/farm-event.js';

export type EventSafetyAction = 'register' | 'register_flagged' | 'escalate_vet' | 'refuse';

export interface EventSafetyDecision {
  readonly action: EventSafetyAction;
  readonly reason: string;
}

// Puerto nuevo (D4 de PLAN-v1.1.md): separado de SafetyPolicy (v1, intacto)
// por ISP, en vez de extender su interface con un método nuevo.
export interface EventSafetyPolicy {
  assessEvent(draft: FarmEventDraft): EventSafetyDecision;
}
