import type { FarmId } from '../../../src/domain/farm/farm.js';
import type { Lot, LotId, LotStatus } from '../../../src/domain/farm/lot.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';
import type { LotRepository } from '../../../src/application/ports/lot-repository.js';
import type { PersistenceError } from '../../../src/application/ports/persistence-error.js';

export class FakeLotRepository implements LotRepository {
  readonly lots = new Map<string, Lot>();

  async findById(farmId: FarmId, lotId: LotId): Promise<Lot | null> {
    return this.lots.get(key(farmId, lotId)) ?? null;
  }

  async save(lot: Lot): Promise<Result<void, PersistenceError>> {
    this.lots.set(key(lot.farmId, lot.id), lot);
    return ok(undefined);
  }

  async list(farmId: FarmId, status?: LotStatus): Promise<Lot[]> {
    return [...this.lots.values()].filter(
      (lot) => lot.farmId === farmId && (status === undefined || lot.status === status),
    );
  }
}

function key(farmId: FarmId, lotId: LotId): string {
  return `${farmId}:${lotId}`;
}
