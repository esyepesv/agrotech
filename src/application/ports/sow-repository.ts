import type { FarmId } from '../../domain/farm/farm.js';
import type { Sow, SowStatus } from '../../domain/farm/sow.js';
import type { Result } from '../../domain/shared/result.js';
import type { PersistenceError } from './persistence-error.js';

export interface SowRepository {
  findByChapeta(farmId: FarmId, chapeta: string): Promise<Sow | null>;
  save(sow: Sow): Promise<Result<void, PersistenceError>>;
  list(farmId: FarmId, status?: SowStatus): Promise<Sow[]>;
}
