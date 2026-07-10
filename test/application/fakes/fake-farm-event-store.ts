import type { FarmId } from '../../../src/domain/farm/farm.js';
import type { FarmEvent } from '../../../src/domain/farm/farm-event.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';
import type {
  EventFilter,
  FarmEventStore,
} from '../../../src/application/ports/farm-event-store.js';
import type { PersistenceError } from '../../../src/application/ports/persistence-error.js';

export class FakeFarmEventStore implements FarmEventStore {
  readonly events: FarmEvent[] = [];

  async append(event: FarmEvent): Promise<Result<void, PersistenceError>> {
    this.events.push(event);
    return ok(undefined);
  }

  async listByFarm(farmId: FarmId, filter?: EventFilter): Promise<FarmEvent[]> {
    return this.events.filter((event) => {
      if (event.farmId !== farmId) return false;
      if (filter?.types && !filter.types.includes(event.payload.type)) return false;
      if (filter?.from && event.occurredAt.getTime() < filter.from.getTime()) return false;
      if (filter?.to && event.occurredAt.getTime() > filter.to.getTime()) return false;
      return true;
    });
  }
}
