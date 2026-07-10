import type { FarmId } from '../../domain/farm/farm.js';
import type { LotStage } from '../../domain/farm/lot.js';
import type { OperatorId } from '../../domain/farm/operator.js';
import type { LotRepository } from '../ports/lot-repository.js';
import type { PendingEventStore } from '../ports/pending-event-store.js';
import type { FarmReply } from './farm-reply.js';

export interface RegisterLotDeps {
  readonly lotRepository: LotRepository;
  readonly pendingEventStore: PendingEventStore;
  readonly pendingTtlSeconds?: number;
}

const DEFAULT_PENDING_TTL_SECONDS = 600;

/**
 * Stub progresivo mínimo (análogo a RegisterSow, PLAN-v1.1.md §9): ofrece
 * crear un lote de pre-cebo/ceba nuevo. La creación real ocurre en
 * ConfirmFarmEvent; se cablea en HandleIncomingMessage a partir de Corte 2.
 */
export class RegisterLot {
  private readonly pendingTtlSeconds: number;

  constructor(private readonly deps: RegisterLotDeps) {
    this.pendingTtlSeconds = deps.pendingTtlSeconds ?? DEFAULT_PENDING_TTL_SECONDS;
  }

  async handle(
    operatorId: OperatorId,
    _farmId: FarmId,
    stage: LotStage,
    animalCount: number,
  ): Promise<FarmReply> {
    await this.deps.pendingEventStore.savePending(
      operatorId,
      { kind: 'register_entity', entity: { entity: 'lot', stage, animalCount } },
      this.pendingTtlSeconds,
    );
    return {
      text: `No tengo registrado ese lote. ¿Creo un lote de ${stage} con ${animalCount} animales?`,
    };
  }
}
