import type { OperatorId } from '../../domain/farm/operator.js';
import type { PendingDraft } from '../../domain/farm/pending-draft.js';
import type { Result } from '../../domain/shared/result.js';
import type { PersistenceError } from './persistence-error.js';

// Estado conversacional corto (TTL), un pending por operario: el nuevo pisa
// al viejo. No es fuente de verdad (PLAN-v1.1.md §7).
export interface PendingEventStore {
  savePending(
    operatorId: OperatorId,
    pending: PendingDraft,
    ttlSeconds: number,
  ): Promise<Result<void, PersistenceError>>;
  // Lee y borra atómicamente; null si no hay pending o si expiró.
  takePending(operatorId: OperatorId): Promise<PendingDraft | null>;
  hasPending(operatorId: OperatorId): Promise<boolean>;
}
