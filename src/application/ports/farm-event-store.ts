import type { FarmId } from '../../domain/farm/farm.js';
import type { FarmEvent, FarmEventType } from '../../domain/farm/farm-event.js';
import type { Result } from '../../domain/shared/result.js';
import type { PersistenceError } from './persistence-error.js';

export interface EventFilter {
  readonly types?: readonly FarmEventType[];
  readonly from?: Date;
  readonly to?: Date;
}

// Ledger append-only: fuente de verdad del módulo farm.
export interface FarmEventStore {
  append(event: FarmEvent): Promise<Result<void, PersistenceError>>;
  listByFarm(farmId: FarmId, filter?: EventFilter): Promise<FarmEvent[]>;
}
