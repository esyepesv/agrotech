import type { EventSource } from './farm-event.js';
import type { InventoryItemId } from './inventory-item.js';
import type { LotId } from './lot.js';
import type { SowId } from './sow.js';

export type MovementDirection = 'in' | 'out';

// Fila del ledger de inventario (no confundir con InventoryItem, que es la
// proyección de saldo). `confirmedAt` queda ausente hasta que el operario
// confirma el draft (ConfirmFarmEvent, Corte 1).
export interface InventoryMovement {
  readonly id: string;
  readonly itemId: InventoryItemId;
  readonly direction: MovementDirection;
  readonly qty: number;
  readonly unitCost?: number;
  readonly reason?: string;
  readonly relatedLotId?: LotId;
  readonly relatedSowId?: SowId;
  readonly occurredAt: Date;
  readonly source: EventSource;
  readonly confidence?: number;
  readonly confirmedAt?: Date;
}
