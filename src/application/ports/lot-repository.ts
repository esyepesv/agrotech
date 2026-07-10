import type { FarmId } from '../../domain/farm/farm.js';
import type { Lot, LotId, LotStatus } from '../../domain/farm/lot.js';
import type { Result } from '../../domain/shared/result.js';
import type { PersistenceError } from './persistence-error.js';

export interface LotRepository {
  findById(farmId: FarmId, lotId: LotId): Promise<Lot | null>;
  save(lot: Lot): Promise<Result<void, PersistenceError>>;
  list(farmId: FarmId, status?: LotStatus): Promise<Lot[]>;
}
