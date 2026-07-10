import type { Farm } from '../../../src/domain/farm/farm.js';
import type { Operator } from '../../../src/domain/farm/operator.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';
import type {
  FarmRepository,
  OperatorWithFarm,
} from '../../../src/application/ports/farm-repository.js';
import type { PersistenceError } from '../../../src/application/ports/persistence-error.js';

export class FakeFarmRepository implements FarmRepository {
  readonly farmsById = new Map<string, Farm>();
  readonly operatorsByHash = new Map<string, Operator>();

  /** Atajo de setup para tests: registra granja + operario de una vez. */
  seedOperator(farm: Farm, operator: Operator): void {
    this.farmsById.set(farm.id, farm);
    this.operatorsByHash.set(operator.channelUserHash, operator);
  }

  async findOperatorByHash(channelUserHash: string): Promise<OperatorWithFarm | null> {
    const operator = this.operatorsByHash.get(channelUserHash);
    if (!operator) {
      return null;
    }
    const farm = this.farmsById.get(operator.farmId);
    if (!farm) {
      return null;
    }
    return { operator, farm };
  }

  async saveFarm(farm: Farm): Promise<Result<void, PersistenceError>> {
    this.farmsById.set(farm.id, farm);
    return ok(undefined);
  }

  async saveOperator(operator: Operator): Promise<Result<void, PersistenceError>> {
    this.operatorsByHash.set(operator.channelUserHash, operator);
    return ok(undefined);
  }
}
