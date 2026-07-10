import type { FarmEventDraft } from '../../domain/farm/farm-event.js';
import type {
  EventSafetyDecision,
  EventSafetyPolicy,
} from '../../application/ports/event-safety-policy.js';

/**
 * Regla de seguridad para eventos ya extraídos (D4/§8 de PLAN-v1.1.md):
 * la medicación se registra igual (confirmación obligatoria del operario
 * es el mitigador), pero se marca para que quede claro que la dosis la
 * valida el veterinario, no PorcIA. El resto de eventos productivos y
 * reproductivos se registra sin más. Es un puerto trivial hoy, pero
 * separado para poder endurecerlo (p. ej. rehusar dosis absurdas) sin
 * tocar los casos de uso que lo consumen.
 */
export class RuleBasedEventSafetyPolicy implements EventSafetyPolicy {
  assessEvent(draft: FarmEventDraft): EventSafetyDecision {
    if (draft.payload.type === 'medication_application') {
      return {
        action: 'register_flagged',
        reason: 'medicación aplicada: se registra el hecho sin validar dosis',
      };
    }
    return { action: 'register', reason: 'hecho productivo/reproductivo' };
  }
}
