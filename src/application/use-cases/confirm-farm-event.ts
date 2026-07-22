import { DEFAULT_META_PARTOS_POR_ANO, DEFAULT_REGION } from '../../domain/farm/farm.js';
import type { Farm } from '../../domain/farm/farm.js';
import { describeDraft } from '../../domain/farm/farm-event.js';
import type { FarmEvent, FarmEventDraft } from '../../domain/farm/farm-event.js';
import type { InventoryMovement } from '../../domain/farm/inventory-movement.js';
import type { Lot } from '../../domain/farm/lot.js';
import type { Operator } from '../../domain/farm/operator.js';
import type { EntityStub } from '../../domain/farm/pending-draft.js';
import type { Sow } from '../../domain/farm/sow.js';
import type { Clock } from '../ports/clock.js';
import type { FarmEventStore } from '../ports/farm-event-store.js';
import type { FarmRepository } from '../ports/farm-repository.js';
import type { InventoryRepository } from '../ports/inventory-repository.js';
import type { LotRepository } from '../ports/lot-repository.js';
import type { PendingEventStore } from '../ports/pending-event-store.js';
import type { SowRepository } from '../ports/sow-repository.js';
import type { FarmReply } from './farm-reply.js';

export interface ConfirmFarmEventDeps {
  readonly pendingEventStore: PendingEventStore;
  readonly farmEventStore: FarmEventStore;
  readonly inventoryRepository: InventoryRepository;
  readonly sowRepository: SowRepository;
  readonly lotRepository: LotRepository;
  readonly farmRepository: FarmRepository;
  readonly clock: Clock;
  // application no importa node:crypto (regla hexagonal): el id lo genera
  // quien construye el caso de uso (en Corte 1, randomUUID real; en tests,
  // un generador secuencial determinista).
  readonly idGenerator: () => string;
}

const NO_PENDING_MESSAGE = 'No tengo nada pendiente de confirmar. ¿Me repites el registro?';
const CANCELLED_MESSAGE = 'Listo, lo descarté. No registré nada.';
const APPEND_FAILED_MESSAGE = 'No pude guardar el registro, inténtalo de nuevo.';
const SAVE_FAILED_MESSAGE = 'No pude guardar el registro, inténtalo de nuevo.';
const PROJECTION_DEGRADED_SUFFIX = ' Quedó anotado; el saldo lo actualizo luego.';
// Ventana para devolver a su sitio un borrador de registro que llegó aquí por
// error de enrutado; corta a propósito, no es fuente de verdad.
const ONBOARDING_RESTORE_TTL = 600;

/**
 * Segundo paso del flujo de registro (PLAN-v1.1.md §2/§7): confirma o
 * descarta el pending del operario. El ledger (FarmEventStore) es la
 * fuente de verdad y se escribe PRIMERO; la proyección de inventario es
 * reconstruible desde el ledger por diseño (R3), así que un fallo ahí no
 * hace fallar la confirmación (el hecho ya quedó guardado).
 */
export class ConfirmFarmEvent {
  constructor(private readonly deps: ConfirmFarmEventDeps) {}

  async handle(reply: 'confirm' | 'cancel', operator: Operator, farm: Farm): Promise<FarmReply> {
    const pending = await this.deps.pendingEventStore.takePending(operator.id);
    if (!pending) {
      return { text: NO_PENDING_MESSAGE };
    }
    if (reply === 'cancel') {
      return { text: CANCELLED_MESSAGE };
    }

    if (pending.kind === 'farm_event') {
      return this.confirmFarmEvent(pending.draft, operator, farm);
    }
    // operator.channelUserHash es opcional en v1.2 (ver operator.ts), pero
    // este operario YA existe (vino de findOperatorByHash) y este flujo
    // legado de v1.1 siempre lo puebla al crearlo (confirmFarmStub, abajo);
    // el id queda como respaldo teórico, nunca debería usarse en la práctica.
    if (pending.kind === 'register_farm_and_user') {
      // El registro conversacional (spec 001) confirma dentro de su propio
      // flujo y guarda su borrador bajo el hash del canal, no bajo el
      // OperatorId. Llegar aquí significa que el orquestador enrutó mal: se
      // devuelve el borrador a su sitio en vez de consumirlo en silencio.
      await this.deps.pendingEventStore.savePending(operator.id, pending, ONBOARDING_RESTORE_TTL);
      return { text: 'Tienes un registro a medias. Dime "registrar" para retomarlo.' };
    }
    return this.confirmEntityStub(pending.entity, operator.channelUserHash ?? operator.id, farm);
  }

  /**
   * Confirmación de un usuario AÚN NO registrado (su pending vive bajo el
   * hash del canal, no bajo un OperatorId): el único pending legítimo en ese
   * estado es el alta de su granja (RegisterFarm). Cualquier otro tipo se
   * descarta en silencio — no debería existir sin operario.
   */
  async handleAnonymous(reply: 'confirm' | 'cancel', channelUserHash: string): Promise<FarmReply> {
    const pending = await this.deps.pendingEventStore.takePending(channelUserHash);
    if (!pending) {
      return { text: NO_PENDING_MESSAGE };
    }
    if (reply === 'cancel') {
      return { text: CANCELLED_MESSAGE };
    }
    if (pending.kind !== 'register_entity' || pending.entity.entity !== 'farm') {
      return { text: NO_PENDING_MESSAGE };
    }
    return this.confirmFarmStub(pending.entity.name, pending.entity.ownerName, channelUserHash);
  }

  private async confirmFarmEvent(
    draft: FarmEventDraft,
    operator: Operator,
    farm: Farm,
  ): Promise<FarmReply> {
    const now = this.deps.clock.now();
    const event: FarmEvent = {
      id: this.deps.idGenerator(),
      farmId: farm.id,
      actorOperatorId: operator.id,
      payload: draft.payload,
      occurredAt: now,
      source: draft.source,
      rawTranscript: draft.rawTranscript,
      confidence: draft.confidence,
      confirmedAt: now,
    };

    const appended = await this.deps.farmEventStore.append(event);
    if (!appended.ok) {
      return { text: APPEND_FAILED_MESSAGE };
    }

    return this.projectEvent(draft, farm.id, event);
  }

  private async projectEvent(
    draft: FarmEventDraft,
    farmId: string,
    event: FarmEvent,
  ): Promise<FarmReply> {
    const payload = draft.payload;
    switch (payload.type) {
      case 'feed_delivery': {
        const itemId = await this.resolveItemId(farmId, payload.itemName);
        const movement: InventoryMovement = {
          id: event.id,
          itemId,
          direction: 'out',
          qty: payload.qty,
          occurredAt: event.occurredAt,
          source: event.source,
          confidence: event.confidence,
          confirmedAt: event.confirmedAt,
        };
        return this.applyAndDescribeMovement(farmId, movement, draft);
      }
      case 'inventory_purchase': {
        const itemId = await this.resolveItemId(farmId, payload.itemName);
        const movement: InventoryMovement = {
          id: event.id,
          itemId,
          direction: 'in',
          qty: payload.qty,
          unitCost: payload.unitCost,
          occurredAt: event.occurredAt,
          source: event.source,
          confidence: event.confidence,
          confirmedAt: event.confirmedAt,
        };
        return this.applyAndDescribeMovement(farmId, movement, draft);
      }
      case 'inventory_adjustment': {
        const existing = await this.deps.inventoryRepository.getItem(farmId, payload.itemName);
        const itemId = existing?.id ?? payload.itemName;
        const currentQty = existing?.currentQty ?? 0;
        const delta = payload.newQty - currentQty;
        if (delta === 0) {
          return {
            text: `Listo, quedó registrado el ajuste de ${payload.itemName} (sin cambio de saldo).`,
          };
        }
        const movement: InventoryMovement = {
          id: event.id,
          itemId,
          direction: delta > 0 ? 'in' : 'out',
          qty: Math.abs(delta),
          reason: payload.reason,
          occurredAt: event.occurredAt,
          source: event.source,
          confidence: event.confidence,
          confirmedAt: event.confirmedAt,
        };
        return this.applyAndDescribeMovement(farmId, movement, draft);
      }
      // Insemination, HeatConfirmation, PenChange, Weaning, Farrowing,
      // WeightControl, MedicationApplication, SanitaryTaskDone: sus
      // proyecciones sobre Sow/Lot llegan en Cortes 2-3 (PLAN-v1.1.md §9).
      // En Corte 0 el ledger append-only (ya escrito arriba) es la única
      // escritura; needsVetReview (medicación) queda tal cual lo dejó el
      // extractor, sin tocarlo aquí.
      default:
        return { text: `Listo, quedó registrado: ${describeDraft(draft)}.` };
    }
  }

  private async resolveItemId(farmId: string, itemName: string): Promise<string> {
    const existing = await this.deps.inventoryRepository.getItem(farmId, itemName);
    // Sin puerto "createItem" explícito: si el item aún no existe, se usa
    // el nombre como id — applyMovement lo crea de una (ver fake, R3).
    return existing?.id ?? itemName;
  }

  private async applyAndDescribeMovement(
    farmId: string,
    movement: InventoryMovement,
    draft: FarmEventDraft,
  ): Promise<FarmReply> {
    const applied = await this.deps.inventoryRepository.applyMovement(farmId, movement);
    if (!applied.ok) {
      return { text: `Listo, ${describeDraft(draft)}.${PROJECTION_DEGRADED_SUFFIX}` };
    }
    return {
      text: `Listo. Te quedan ${applied.value.currentQty} ${applied.value.unit} de ${applied.value.name}.`,
    };
  }

  private async confirmEntityStub(
    entity: EntityStub,
    channelUserHash: string,
    farm: Farm,
  ): Promise<FarmReply> {
    switch (entity.entity) {
      case 'farm':
        return this.confirmFarmStub(entity.name, entity.ownerName, channelUserHash);
      case 'sow':
        return this.confirmSowStub(entity.chapeta, farm);
      case 'lot':
        return this.confirmLotStub(entity.stage, entity.animalCount, farm);
      default:
        return unreachable(entity);
    }
  }

  private async confirmFarmStub(
    name: string,
    ownerName: string | undefined,
    channelUserHash: string,
  ): Promise<FarmReply> {
    const newFarm: Farm = {
      id: this.deps.idGenerator(),
      name,
      ownerName,
      config: { metaPartosPorAno: DEFAULT_META_PARTOS_POR_ANO, region: DEFAULT_REGION },
      createdAt: this.deps.clock.now(),
    };
    const savedFarm = await this.deps.farmRepository.saveFarm(newFarm);
    if (!savedFarm.ok) {
      return { text: SAVE_FAILED_MESSAGE };
    }
    const newOperator: Operator = {
      id: this.deps.idGenerator(),
      // Flujo legado de v1.1 (auto-alta anónima): no pasa por
      // RegisterFarmAndUser ni crea un AppUser real, así que no hay un
      // AppUserId genuino que referenciar; se genera uno sintético solo
      // para satisfacer el campo requerido del nuevo Operator de v1.2
      // (cambio mínimo para compilar — ver operator.ts).
      userId: this.deps.idGenerator(),
      farmId: newFarm.id,
      channelUserHash,
      role: 'administrador_dueno',
      status: 'activo',
    };
    const savedOperator = await this.deps.farmRepository.saveOperator(newOperator);
    if (!savedOperator.ok) {
      return { text: SAVE_FAILED_MESSAGE };
    }
    return { text: `Listo, creé tu granja "${newFarm.name}". Ya puedes registrar tus datos.` };
  }

  private async confirmSowStub(chapeta: string, farm: Farm): Promise<FarmReply> {
    const sow: Sow = {
      id: this.deps.idGenerator(),
      farmId: farm.id,
      chapeta,
      status: 'reemplazo',
    };
    const saved = await this.deps.sowRepository.save(sow);
    if (!saved.ok) {
      return { text: SAVE_FAILED_MESSAGE };
    }
    return { text: `Listo, registré la cerda ${chapeta}.` };
  }

  private async confirmLotStub(
    stage: Lot['stage'],
    animalCount: number,
    farm: Farm,
  ): Promise<FarmReply> {
    const lot: Lot = {
      id: this.deps.idGenerator(),
      farmId: farm.id,
      stage,
      animalCount,
      status: 'activo',
    };
    const saved = await this.deps.lotRepository.save(lot);
    if (!saved.ok) {
      return { text: SAVE_FAILED_MESSAGE };
    }
    return { text: `Listo, registré un lote de ${stage} con ${animalCount} animales.` };
  }
}

export const CONFIRM_FARM_EVENT_MESSAGES = {
  noPending: NO_PENDING_MESSAGE,
  cancelled: CANCELLED_MESSAGE,
  appendFailed: APPEND_FAILED_MESSAGE,
  saveFailed: SAVE_FAILED_MESSAGE,
} as const;

function unreachable(value: never): never {
  throw new Error(`stub de entidad no soportado: ${JSON.stringify(value)}`);
}
