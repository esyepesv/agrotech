import type { FarmId } from '../../domain/farm/farm.js';
import type { Clock } from '../ports/clock.js';
import type { FarmEventStore } from '../ports/farm-event-store.js';
import type { InventoryRepository } from '../ports/inventory-repository.js';
import type { FarmReply } from './farm-reply.js';

export interface QueryFarmStateDeps {
  readonly inventoryRepository: InventoryRepository;
  readonly farmEventStore: FarmEventStore;
  readonly clock: Clock;
}

const NO_INVENTORY_MESSAGE = 'No tengo inventario registrado aún.';
const NO_CONSUMPTION_MESSAGE = 'No tengo consumos registrados este mes.';
const NO_COST_DATA_MESSAGE =
  'Tengo los consumos anotados pero sin costos; registra las compras con precio para calcular gastos.';
const FALLBACK_MESSAGE =
  'Puedo decirte cuánto inventario te queda o cuánto llevas gastado. ¿Qué quieres saber?';

// Patrones sobre texto normalizado (minúsculas, sin tildes): heurística de
// palabras clave sin LLM (Corte 0). En Corte 1+ puede refinarse con el
// IntentClassifier/EventExtractor si hace falta más precisión.
const INVENTORY_PATTERN = /\b(queda\w*|inventario)\b/;
const EXPENSE_PATTERN = /\bgast\w*/;

/**
 * Lecturas simples sobre el estado de la granja (PLAN-v1.1.md §4): saldo
 * de inventario y gasto aproximado del mes en curso. Corte 0 cubre
 * concentrado; el resto de consultas (plan sanitario, KPIs) llega en
 * Cortes 2-4.
 */
export class QueryFarmState {
  constructor(private readonly deps: QueryFarmStateDeps) {}

  async handle(farmId: FarmId, text: string): Promise<FarmReply> {
    const normalized = normalize(text);
    const asksTengo = normalized.includes('cuanto') && normalized.includes('tengo');

    if (INVENTORY_PATTERN.test(normalized) || asksTengo) {
      return this.reportInventory(farmId);
    }
    if (EXPENSE_PATTERN.test(normalized)) {
      return this.reportExpense(farmId);
    }
    return { text: FALLBACK_MESSAGE };
  }

  private async reportInventory(farmId: FarmId): Promise<FarmReply> {
    const items = await this.deps.inventoryRepository.listItems(farmId, 'concentrado');
    if (items.length === 0) {
      return { text: NO_INVENTORY_MESSAGE };
    }
    const parts = items.map((item) => `${item.currentQty} ${item.unit} de ${item.name}`);
    return { text: `Te quedan: ${parts.join(', ')}.` };
  }

  private async reportExpense(farmId: FarmId): Promise<FarmReply> {
    const now = this.deps.clock.now();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const movements = await this.deps.inventoryRepository.listMovements(farmId, { from, to: now });
    const outMovements = movements.filter((movement) => movement.direction === 'out');

    if (outMovements.length === 0) {
      return { text: NO_CONSUMPTION_MESSAGE };
    }

    const items = await this.deps.inventoryRepository.listItems(farmId);
    const itemById = new Map(items.map((item) => [item.id, item]));

    let total = 0;
    let anyCost = false;
    for (const movement of outMovements) {
      const unitCost = movement.unitCost ?? itemById.get(movement.itemId)?.avgUnitCost;
      if (unitCost === undefined) {
        continue;
      }
      anyCost = true;
      total += movement.qty * unitCost;
    }

    if (!anyCost) {
      return { text: NO_COST_DATA_MESSAGE };
    }
    return {
      text: `Este mes llevas gastado aproximadamente $${Math.round(total)} en concentrado.`,
    };
  }
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export const QUERY_FARM_STATE_MESSAGES = {
  noInventory: NO_INVENTORY_MESSAGE,
  noConsumption: NO_CONSUMPTION_MESSAGE,
  noCostData: NO_COST_DATA_MESSAGE,
  fallback: FALLBACK_MESSAGE,
} as const;
