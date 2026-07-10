import type { FarmContext } from '../../domain/farm/farm-context.js';
import type { EventSource } from '../../domain/farm/farm-event.js';
import { describeDraft, isDraftComplete } from '../../domain/farm/farm-event.js';
import type { OperatorId } from '../../domain/farm/operator.js';
import type { Clock } from '../ports/clock.js';
import type { EventExtractor } from '../ports/event-extractor.js';
import type { EventSafetyPolicy } from '../ports/event-safety-policy.js';
import type { PendingEventStore } from '../ports/pending-event-store.js';
import type { FarmReply } from './farm-reply.js';

export interface LogFarmEventDeps {
  readonly eventExtractor: EventExtractor;
  readonly eventSafetyPolicy: EventSafetyPolicy;
  readonly pendingEventStore: PendingEventStore;
  readonly clock: Clock;
  /** TTL del pending en segundos (PLAN-v1.1.md §7); default 600 (10 min). */
  readonly pendingTtlSeconds?: number;
}

const DEFAULT_PENDING_TTL_SECONDS = 600;

const EXTRACTION_FAILED_MESSAGE =
  'No entendí qué quieres registrar. ¿Me lo repites con cantidad y producto?';

// Mensaje propio (más corto) para la rama de eventos, en el espíritu del
// ESCALATION_MESSAGE de v1 (answer-query.ts): nunca damos consejo clínico.
const ESCALATION_MESSAGE =
  'Ese registro involucra salud animal delicada y no me corresponde decidir por ti. ' +
  'Coméntaselo directamente a tu veterinario antes de continuar.';

const REFUSAL_MESSAGE = 'Ese registro está fuera de lo que puedo anotar por ahora.';

const FLAGGED_HINT = ' Lo anoto como dato para tu registro; la dosis la valida tu veterinario.';

/**
 * Primer paso del flujo de registro conversacional (PLAN-v1.1.md §2/§6):
 * extrae el draft, aplica la política de seguridad de eventos y, si falta
 * información o está completo, guarda un pending y pide la confirmación
 * obligatoria del operario. Nunca persiste (eso es de ConfirmFarmEvent).
 */
export class LogFarmEvent {
  private readonly pendingTtlSeconds: number;

  constructor(private readonly deps: LogFarmEventDeps) {
    this.pendingTtlSeconds = deps.pendingTtlSeconds ?? DEFAULT_PENDING_TTL_SECONDS;
  }

  async handle(
    operatorId: OperatorId,
    text: string,
    ctx: FarmContext,
    source: EventSource,
  ): Promise<FarmReply> {
    const extracted = await this.deps.eventExtractor.extract(text, ctx, source);
    if (!extracted.ok) {
      return { text: EXTRACTION_FAILED_MESSAGE };
    }

    const draft = extracted.value;
    const decision = this.deps.eventSafetyPolicy.assessEvent(draft);

    if (decision.action === 'escalate_vet') {
      return { text: ESCALATION_MESSAGE };
    }
    if (decision.action === 'refuse') {
      return { text: REFUSAL_MESSAGE };
    }

    if (!isDraftComplete(draft)) {
      await this.deps.pendingEventStore.savePending(
        operatorId,
        { kind: 'farm_event', draft },
        this.pendingTtlSeconds,
      );
      return { text: `Me falta saber: ${draft.camposFaltantes.join(', ')}. ¿Me lo dices?` };
    }

    await this.deps.pendingEventStore.savePending(
      operatorId,
      { kind: 'farm_event', draft },
      this.pendingTtlSeconds,
    );
    const base = `Entendí: ${describeDraft(draft)}. ¿Confirmo?`;
    return { text: decision.action === 'register_flagged' ? `${base}${FLAGGED_HINT}` : base };
  }
}

export const LOG_FARM_EVENT_MESSAGES = {
  extractionFailed: EXTRACTION_FAILED_MESSAGE,
  escalation: ESCALATION_MESSAGE,
  refusal: REFUSAL_MESSAGE,
  flaggedHint: FLAGGED_HINT,
} as const;
