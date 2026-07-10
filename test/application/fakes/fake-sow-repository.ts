import type { FarmId } from '../../../src/domain/farm/farm.js';
import type { Sow, SowStatus } from '../../../src/domain/farm/sow.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';
import type { SowRepository } from '../../../src/application/ports/sow-repository.js';
import type { PersistenceError } from '../../../src/application/ports/persistence-error.js';

export class FakeSowRepository implements SowRepository {
  readonly sows = new Map<string, Sow>();

  async findByChapeta(farmId: FarmId, chapeta: string): Promise<Sow | null> {
    return this.sows.get(key(farmId, chapeta)) ?? null;
  }

  async save(sow: Sow): Promise<Result<void, PersistenceError>> {
    this.sows.set(key(sow.farmId, sow.chapeta), sow);
    return ok(undefined);
  }

  async list(farmId: FarmId, status?: SowStatus): Promise<Sow[]> {
    return [...this.sows.values()].filter(
      (sow) => sow.farmId === farmId && (status === undefined || sow.status === status),
    );
  }
}

function key(farmId: FarmId, chapeta: string): string {
  return `${farmId}:${chapeta}`;
}
