import type { SupabaseClient } from '@supabase/supabase-js';
import type { FarmId } from '../../domain/farm/farm.js';
import type { InventoryItem, InventoryKind, InventoryUnit } from '../../domain/farm/inventory-item.js';
import type { InventoryMovement, MovementDirection } from '../../domain/farm/inventory-movement.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type {
  InventoryRepository,
  MovementPeriod,
} from '../../application/ports/inventory-repository.js';
import type { PersistenceError } from '../../application/ports/persistence-error.js';
import { persistenceError } from '../../application/ports/persistence-error.js';

const ITEM_TABLE = 'inventory_item';
const MOVEMENT_TABLE = 'inventory_movement';

// Defaults conservadores cuando se crea un item nuevo desde un movimiento
// (compra/consumo) sin puerto "createItem" explícito: el caso más común del
// piloto es concentrado por bulto. El extractor/los casos de uso podrán
// refinar kind/unit reales en un corte futuro; esto NO es un valor de
// negocio inventado, es un placeholder de esquema hasta que exista ese flujo.
const DEFAULT_NEW_ITEM_KIND: InventoryKind = 'concentrado';
const DEFAULT_NEW_ITEM_UNIT: InventoryUnit = 'bulto';

interface InventoryItemRow {
  readonly id: string;
  readonly farm_id: string;
  readonly kind: string;
  readonly name: string;
  readonly brand: string | null;
  readonly unit: string;
  readonly current_qty: number;
  readonly avg_unit_cost: number | null;
}

interface InventoryMovementRow {
  readonly id: string;
  readonly item_id: string;
  readonly direction: string;
  readonly qty: number;
  readonly unit_cost: number | null;
  readonly reason: string | null;
  readonly related_lot_id: string | null;
  readonly related_sow_id: string | null;
  readonly occurred_at: string;
  readonly source: string;
  readonly confidence: number | null;
  readonly confirmed_at: string | null;
}

/**
 * Proyección de inventario en Supabase (no es el ledger: FarmEventStore lo
 * es). `applyMovement` NO usa RPC transaccional (mejora futura anotada en
 * R3 de PLAN-v1.1.md): inserta el movimiento primero y luego actualiza el
 * saldo del item; si el update fallara, el movimiento ya habría quedado
 * escrito y el saldo es reconstruible desde `inventory_movement` (y, en
 * última instancia, desde el ledger `farm_event`).
 */
export class SupabaseInventoryRepository implements InventoryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getItem(farmId: FarmId, name: string): Promise<InventoryItem | null> {
    const row = await this.selectItemByName(farmId, name);
    return row ? toItem(row) : null;
  }

  async applyMovement(
    farmId: FarmId,
    movement: InventoryMovement,
  ): Promise<Result<InventoryItem, PersistenceError>> {
    const resolved = await this.resolveOrCreateItem(farmId, movement);
    if (!resolved.ok) {
      return resolved;
    }
    const item = resolved.value;

    const movementRow = fromMovement(item.id, movement);
    const { error: movementError } = await this.client.from(MOVEMENT_TABLE).insert(movementRow);
    if (movementError !== null) {
      return err(
        persistenceError(`fallo al registrar movimiento de inventario: ${movementError.message}`),
      );
    }

    const delta = movement.direction === 'in' ? movement.qty : -movement.qty;
    const newQty = item.current_qty + delta;
    const newAvgUnitCost =
      movement.direction === 'in' && movement.unitCost !== undefined
        ? weightedAverage(item, movement)
        : item.avg_unit_cost;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- desajuste conocido de genéricos de supabase-js (ver pgvector-retriever.ts)
    const { data, error } = await this.client
      .from(ITEM_TABLE)
      .update({ current_qty: newQty, avg_unit_cost: newAvgUnitCost })
      .eq('id', item.id)
      .select()
      .maybeSingle();

    if (error !== null || data === null) {
      return err(
        persistenceError(
          `fallo al actualizar saldo de inventario: ${error?.message ?? 'sin fila actualizada'}`,
        ),
      );
    }
    return ok(toItem(data as InventoryItemRow));
  }

  async listItems(farmId: FarmId, kind?: InventoryKind): Promise<InventoryItem[]> {
    let query = this.client.from(ITEM_TABLE).select('*').eq('farm_id', farmId);
    if (kind !== undefined) {
      query = query.eq('kind', kind);
    }
    const { data, error } = await query;
    if (error !== null || data === null) {
      return [];
    }
    return (data as InventoryItemRow[]).map(toItem);
  }

  async listMovements(farmId: FarmId, period: MovementPeriod): Promise<InventoryMovement[]> {
    // inventory_movement no tiene farm_id propio (solo item_id): en vez de un
    // join `inventory_item!inner(farm_id)` (más frágil de tipar con el
    // cliente "pelado" de supabase-js), se resuelven primero los ids de item
    // de la granja y se filtra con `in()`. Dos queries simples > un embed
    // anidado difícil de tipar sin generar Database types.
    const itemIds = await this.listItemIds(farmId);
    if (itemIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from(MOVEMENT_TABLE)
      .select('*')
      .in('item_id', itemIds)
      .gte('occurred_at', period.from.toISOString())
      .lte('occurred_at', period.to.toISOString())
      .order('occurred_at', { ascending: true });

    if (error !== null || data === null) {
      return [];
    }
    return (data as InventoryMovementRow[]).map(toMovement);
  }

  private async listItemIds(farmId: FarmId): Promise<string[]> {
    const { data, error } = await this.client.from(ITEM_TABLE).select('id').eq('farm_id', farmId);
    if (error !== null || data === null) {
      return [];
    }
    return (data as { id: string }[]).map((row) => row.id);
  }

  private async resolveOrCreateItem(
    farmId: FarmId,
    movement: InventoryMovement,
  ): Promise<Result<InventoryItemRow, PersistenceError>> {
    // 1. movement.itemId puede ser un uuid real ya conocido (viene de un
    //    getItem previo). Si la búsqueda por id falla (no existe, o el
    //    texto ni siquiera es un uuid válido y Postgres devuelve error),
    //    se sigue al siguiente paso: no se trata como fallo duro.
    const byId = await this.selectItemById(movement.itemId);
    if (byId) {
      return ok(byId);
    }

    // 2. Semántica de ConfirmFarmEvent.resolveItemId: si el item aún no
    //    existe, itemId ES el nombre en texto plano, no un uuid.
    const byName = await this.selectItemByName(farmId, movement.itemId);
    if (byName) {
      return ok(byName);
    }

    // 3. No existe: se crea con defaults conservadores (ver constantes).
    return this.createItem(farmId, movement.itemId);
  }

  private async selectItemById(id: string): Promise<InventoryItemRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(ITEM_TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    return data as InventoryItemRow;
  }

  private async selectItemByName(farmId: FarmId, name: string): Promise<InventoryItemRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(ITEM_TABLE)
      .select('*')
      .eq('farm_id', farmId)
      .eq('name', name)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    return data as InventoryItemRow;
  }

  private async createItem(
    farmId: FarmId,
    name: string,
  ): Promise<Result<InventoryItemRow, PersistenceError>> {
    const newRow = {
      farm_id: farmId,
      kind: DEFAULT_NEW_ITEM_KIND,
      name,
      brand: null,
      unit: DEFAULT_NEW_ITEM_UNIT,
      current_qty: 0,
      avg_unit_cost: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(ITEM_TABLE)
      .insert(newRow)
      .select()
      .maybeSingle();
    if (error !== null || data === null) {
      return err(
        persistenceError(
          `fallo al crear item de inventario: ${error?.message ?? 'sin fila insertada'}`,
        ),
      );
    }
    return ok(data as InventoryItemRow);
  }
}

function toItem(row: InventoryItemRow): InventoryItem {
  return {
    id: row.id,
    farmId: row.farm_id,
    kind: row.kind as InventoryKind,
    name: row.name,
    brand: row.brand ?? undefined,
    unit: row.unit as InventoryUnit,
    currentQty: row.current_qty,
    avgUnitCost: row.avg_unit_cost ?? undefined,
  };
}

function fromMovement(itemId: string, movement: InventoryMovement): InventoryMovementRow {
  return {
    id: movement.id,
    item_id: itemId,
    direction: movement.direction,
    qty: movement.qty,
    unit_cost: movement.unitCost ?? null,
    reason: movement.reason ?? null,
    related_lot_id: movement.relatedLotId ?? null,
    related_sow_id: movement.relatedSowId ?? null,
    occurred_at: movement.occurredAt.toISOString(),
    source: movement.source,
    confidence: movement.confidence ?? null,
    confirmed_at: movement.confirmedAt?.toISOString() ?? null,
  };
}

function toMovement(row: InventoryMovementRow): InventoryMovement {
  return {
    id: row.id,
    itemId: row.item_id,
    direction: row.direction as MovementDirection,
    qty: row.qty,
    unitCost: row.unit_cost ?? undefined,
    reason: row.reason ?? undefined,
    relatedLotId: row.related_lot_id ?? undefined,
    relatedSowId: row.related_sow_id ?? undefined,
    occurredAt: new Date(row.occurred_at),
    source: row.source as InventoryMovement['source'],
    confidence: row.confidence ?? undefined,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : undefined,
  };
}

// Mismo cálculo que FakeInventoryRepository (test/application/fakes), para
// que el comportamiento observable sea idéntico entre fake y adaptador real.
function weightedAverage(existing: InventoryItemRow, movement: InventoryMovement): number {
  const existingCost = existing.avg_unit_cost ?? movement.unitCost ?? 0;
  const totalExistingValue = existing.current_qty * existingCost;
  const incomingValue = movement.qty * (movement.unitCost ?? 0);
  const totalQty = existing.current_qty + movement.qty;
  return totalQty > 0 ? (totalExistingValue + incomingValue) / totalQty : existingCost;
}
