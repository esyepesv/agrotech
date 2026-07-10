import type { InventoryKind, InventoryUnit } from './inventory-item.js';
import type { LotId } from './lot.js';
import type { OperatorId } from './operator.js';
import type { FarmId } from './farm.js';

// Imagen (OCR) queda diferida fuera de v1.1 (D6 de PLAN-v1.1.md): el origen
// de un evento solo puede ser voz o texto.
export type EventSource = 'voice' | 'text';

export interface FeedDelivery {
  readonly type: 'feed_delivery';
  readonly itemName: string;
  readonly qty: number;
  readonly unit: InventoryUnit;
  readonly targetKind: 'lot' | 'sow' | 'general';
  readonly lotId?: LotId;
  readonly sowChapeta?: string;
  readonly penNumber?: number;
}

export interface InventoryPurchase {
  readonly type: 'inventory_purchase';
  readonly itemName: string;
  readonly kind: InventoryKind;
  readonly qty: number;
  readonly unit: InventoryUnit;
  readonly unitCost?: number;
  readonly brand?: string;
}

export interface InventoryAdjustment {
  readonly type: 'inventory_adjustment';
  readonly itemName: string;
  readonly newQty: number;
  readonly reason?: string;
}

export interface Insemination {
  readonly type: 'insemination';
  readonly chapeta: string;
  readonly occurredOn?: Date;
  readonly boarOrSemen?: string;
}

export interface HeatConfirmation {
  readonly type: 'heat_confirmation';
  readonly chapeta: string;
}

export interface PenChange {
  readonly type: 'pen_change';
  readonly chapeta?: string;
  readonly lotId?: LotId;
  readonly toPen: number;
}

export interface Weaning {
  readonly type: 'weaning';
  readonly chapeta: string;
  readonly pigletsWeaned?: number;
  readonly avgWeightKg?: number;
}

export interface Farrowing {
  readonly type: 'farrowing';
  readonly chapeta: string;
  readonly bornAlive?: number;
  readonly bornDead?: number;
  readonly mummified?: number;
}

export interface WeightControl {
  readonly type: 'weight_control';
  readonly chapeta?: string;
  readonly lotId?: LotId;
  readonly avgWeightKg: number;
}

export interface MedicationApplication {
  readonly type: 'medication_application';
  readonly chapeta?: string;
  readonly lotId?: LotId;
  readonly product: string;
  readonly doseText?: string;
  readonly needsVetReview: boolean;
}

export interface SanitaryTaskDone {
  readonly type: 'sanitary_task_done';
  readonly taskLabel: string;
  readonly chapeta?: string;
  readonly lotId?: LotId;
}

export type FarmEventPayload =
  | FeedDelivery
  | InventoryPurchase
  | InventoryAdjustment
  | Insemination
  | HeatConfirmation
  | PenChange
  | Weaning
  | Farrowing
  | WeightControl
  | MedicationApplication
  | SanitaryTaskDone;

export type FarmEventType = FarmEventPayload['type'];

// Entrada del ledger (append-only): un evento ya confirmado por el operario.
export interface FarmEvent {
  readonly id: string;
  readonly farmId: FarmId;
  readonly actorOperatorId: OperatorId;
  readonly payload: FarmEventPayload;
  readonly occurredAt: Date;
  readonly source: EventSource;
  readonly rawTranscript?: string;
  readonly confidence?: number;
  readonly confirmedAt: Date;
}

// Lo que produce el EventExtractor: nunca se persiste directamente (guardrail
// de LogFarmEvent/ConfirmFarmEvent, §6 de PLAN-v1.1.md). Si camposFaltantes
// no está vacío, el caso de uso pregunta por lo que falta antes de confirmar.
export interface FarmEventDraft {
  readonly payload: FarmEventPayload;
  readonly confidence: number;
  readonly camposFaltantes: readonly string[];
  readonly rawTranscript: string;
  readonly source: EventSource;
}

export function isDraftComplete(draft: FarmEventDraft): boolean {
  return draft.camposFaltantes.length === 0;
}

/**
 * Frase corta en español para la confirmación obligatoria ("Entendí: X.
 * ¿Confirmo?", LogFarmEvent). El switch exhaustivo (vía `unreachable`)
 * obliga a actualizar esta función cuando se agregue un tipo de evento.
 */
export function describeDraft(draft: FarmEventDraft): string {
  const payload = draft.payload;
  switch (payload.type) {
    case 'feed_delivery':
      return describeFeedDelivery(payload);
    case 'inventory_purchase':
      return describeInventoryPurchase(payload);
    case 'inventory_adjustment':
      return `Ajuste de inventario: ${payload.itemName} queda en ${payload.newQty}${
        payload.reason ? ` (${payload.reason})` : ''
      }`;
    case 'insemination':
      return `Inseminación de la cerda ${payload.chapeta}${
        payload.occurredOn ? ` el ${formatDate(payload.occurredOn)}` : ''
      }${payload.boarOrSemen ? ` con ${payload.boarOrSemen}` : ''}`;
    case 'heat_confirmation':
      return `Confirmación de celo de la cerda ${payload.chapeta}`;
    case 'pen_change':
      return `Cambio de corral${describeSubject(payload.chapeta, payload.lotId)} al corral ${payload.toPen}`;
    case 'weaning':
      return `Destete de la cerda ${payload.chapeta}${
        payload.pigletsWeaned !== undefined ? ` con ${payload.pigletsWeaned} lechones` : ''
      }${payload.avgWeightKg !== undefined ? ` (peso prom. ${payload.avgWeightKg} kg)` : ''}`;
    case 'farrowing':
      return describeFarrowing(payload);
    case 'weight_control':
      return `Control de peso${describeSubject(payload.chapeta, payload.lotId)}: ${payload.avgWeightKg} kg promedio`;
    case 'medication_application':
      return `Aplicación de ${payload.product}${describeSubject(payload.chapeta, payload.lotId)}${
        payload.doseText ? ` (${payload.doseText})` : ''
      }`;
    case 'sanitary_task_done':
      return `Tarea sanitaria "${payload.taskLabel}" realizada${describeSubject(payload.chapeta, payload.lotId)}`;
    default:
      return unreachable(payload);
  }
}

function describeFeedDelivery(payload: FeedDelivery): string {
  const base = `${payload.qty} ${payload.unit} de ${payload.itemName}`;
  if (payload.targetKind === 'lot') {
    return payload.penNumber !== undefined
      ? `${base} a la ceba del corral ${payload.penNumber}`
      : `${base} al lote`;
  }
  if (payload.targetKind === 'sow') {
    return payload.sowChapeta !== undefined
      ? `${base} a la cerda ${payload.sowChapeta}`
      : `${base} a la cerda`;
  }
  return `${base} al inventario general`;
}

function describeInventoryPurchase(payload: InventoryPurchase): string {
  const marca = payload.brand ? ` marca ${payload.brand}` : '';
  const costo = payload.unitCost !== undefined ? ` a $${payload.unitCost} c/u` : '';
  return `Compra de ${payload.qty} ${payload.unit} de ${payload.itemName}${marca}${costo}`;
}

function describeFarrowing(payload: Farrowing): string {
  const partes: string[] = [`Parto de la cerda ${payload.chapeta}`];
  if (payload.bornAlive !== undefined) partes.push(`${payload.bornAlive} nacidos vivos`);
  if (payload.bornDead !== undefined) partes.push(`${payload.bornDead} muertos`);
  if (payload.mummified !== undefined) partes.push(`${payload.mummified} momificados`);
  return partes.join(', ');
}

function describeSubject(chapeta: string | undefined, lotId: LotId | undefined): string {
  if (chapeta !== undefined) return ` de la cerda ${chapeta}`;
  if (lotId !== undefined) return ` del lote ${lotId}`;
  return '';
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function unreachable(value: never): never {
  throw new Error(`tipo de evento no soportado: ${JSON.stringify(value)}`);
}
