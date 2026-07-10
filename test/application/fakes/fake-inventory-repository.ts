import type { FarmId } from '../../../src/domain/farm/farm.js';
import type { InventoryItem, InventoryKind } from '../../../src/domain/farm/inventory-item.js';
import type { InventoryMovement } from '../../../src/domain/farm/inventory-movement.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';
import type {
  InventoryRepository,
  MovementPeriod,
} from '../../../src/application/ports/inventory-repository.js';
import type { PersistenceError } from '../../../src/application/ports/persistence-error.js';

export class FakeInventoryRepository implements InventoryRepository {
  readonly items = new Map<string, InventoryItem>();
  readonly movements: InventoryMovement[] = [];

  /** Atajo de setup para tests: siembra un item ya existente. */
  seedItem(item: InventoryItem): void {
    this.items.set(key(item.farmId, item.id), item);
  }

  async getItem(farmId: FarmId, name: string): Promise<InventoryItem | null> {
    for (const item of this.items.values()) {
      if (item.farmId === farmId && item.name === name) {
        return item;
      }
    }
    return null;
  }

  async applyMovement(
    farmId: FarmId,
    movement: InventoryMovement,
  ): Promise<Result<InventoryItem, PersistenceError>> {
    this.movements.push(movement);
    const itemKey = key(farmId, movement.itemId);
    const existing = this.items.get(itemKey);
    const delta = movement.direction === 'in' ? movement.qty : -movement.qty;

    if (!existing) {
      // Corte 0: el fake no tiene forma de resolver nombre/kind/unit reales
      // desde un itemId nuevo (no hay puerto "createItem"); el caso de uso
      // real deberá pasar un itemId ya conocido vía getItem previo.
      const created: InventoryItem = {
        id: movement.itemId,
        farmId,
        kind: 'concentrado',
        name: movement.itemId,
        unit: 'bulto',
        currentQty: delta,
        avgUnitCost: movement.unitCost,
      };
      this.items.set(itemKey, created);
      return ok(created);
    }

    // La validación de negocio (p.ej. no dejar qty negativo) no vive en el
    // repo: aquí se registra tal cual, como pide la especificación del fake.
    const avgUnitCost =
      movement.direction === 'in' && movement.unitCost !== undefined
        ? weightedAverage(existing, movement)
        : existing.avgUnitCost;
    const updated: InventoryItem = {
      ...existing,
      currentQty: existing.currentQty + delta,
      avgUnitCost,
    };
    this.items.set(itemKey, updated);
    return ok(updated);
  }

  async listItems(farmId: FarmId, kind?: InventoryKind): Promise<InventoryItem[]> {
    return [...this.items.values()].filter(
      (item) => item.farmId === farmId && (kind === undefined || item.kind === kind),
    );
  }

  async listMovements(farmId: FarmId, period: MovementPeriod): Promise<InventoryMovement[]> {
    const idsDeLaGranja = new Set(
      [...this.items.values()].filter((item) => item.farmId === farmId).map((item) => item.id),
    );
    return this.movements.filter(
      (movement) =>
        idsDeLaGranja.has(movement.itemId) &&
        movement.occurredAt.getTime() >= period.from.getTime() &&
        movement.occurredAt.getTime() <= period.to.getTime(),
    );
  }
}

function key(farmId: FarmId, itemId: string): string {
  return `${farmId}:${itemId}`;
}

function weightedAverage(existing: InventoryItem, movement: InventoryMovement): number {
  const existingCost = existing.avgUnitCost ?? movement.unitCost ?? 0;
  const totalExistingValue = existing.currentQty * existingCost;
  const incomingValue = movement.qty * (movement.unitCost ?? 0);
  const totalQty = existing.currentQty + movement.qty;
  return totalQty > 0 ? (totalExistingValue + incomingValue) / totalQty : existingCost;
}
