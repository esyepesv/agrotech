import type { FarmId } from './farm.js';

export type InventoryItemId = string;

export type InventoryKind = 'concentrado' | 'vacuna' | 'insumo';

export type InventoryUnit = 'bulto' | 'dosis' | 'litro' | 'unidad';

// Proyección de estado (no es el ledger): saldo actual y costo promedio,
// reconstruible desde InventoryMovement por diseño (R3 de PLAN-v1.1.md).
export interface InventoryItem {
  readonly id: InventoryItemId;
  readonly farmId: FarmId;
  readonly kind: InventoryKind;
  readonly name: string;
  readonly brand?: string;
  readonly unit: InventoryUnit;
  readonly currentQty: number;
  readonly avgUnitCost?: number;
}
