import type { FarmId } from '../../domain/farm/farm.js';
import type { InventoryItem, InventoryKind } from '../../domain/farm/inventory-item.js';
import type { InventoryMovement } from '../../domain/farm/inventory-movement.js';
import type { Result } from '../../domain/shared/result.js';
import type { PersistenceError } from './persistence-error.js';

export interface MovementPeriod {
  readonly from: Date;
  readonly to: Date;
}

export interface InventoryRepository {
  getItem(farmId: FarmId, name: string): Promise<InventoryItem | null>;
  // Crea el item si no existe para un movimiento 'in'; actualiza currentQty
  // y avgUnitCost (promedio ponderado). La proyección es reconstruible desde
  // el ledger (FarmEventStore) por diseño (R3 de PLAN-v1.1.md).
  applyMovement(
    farmId: FarmId,
    movement: InventoryMovement,
  ): Promise<Result<InventoryItem, PersistenceError>>;
  listItems(farmId: FarmId, kind?: InventoryKind): Promise<InventoryItem[]>;
  listMovements(farmId: FarmId, period: MovementPeriod): Promise<InventoryMovement[]>;
}
