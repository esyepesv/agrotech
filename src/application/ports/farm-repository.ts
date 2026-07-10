import type { Farm } from '../../domain/farm/farm.js';
import type { Operator } from '../../domain/farm/operator.js';
import type { Result } from '../../domain/shared/result.js';
import type { PersistenceError } from './persistence-error.js';

export interface OperatorWithFarm {
  readonly operator: Operator;
  readonly farm: Farm;
}

export interface FarmRepository {
  // Resuelve identidad a partir del hash del canal (HMAC con USER_ID_SALT,
  // D2 de PLAN-v1.1.md); null si el operario no está registrado.
  findOperatorByHash(channelUserHash: string): Promise<OperatorWithFarm | null>;
  saveFarm(farm: Farm): Promise<Result<void, PersistenceError>>;
  saveOperator(operator: Operator): Promise<Result<void, PersistenceError>>;
}
