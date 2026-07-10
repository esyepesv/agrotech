import type { FarmId } from '../../domain/farm/farm.js';
import type { OperatorId } from '../../domain/farm/operator.js';
import type { PendingEventStore } from '../ports/pending-event-store.js';
import type { SowRepository } from '../ports/sow-repository.js';
import type { FarmReply } from './farm-reply.js';

export interface RegisterSowDeps {
  readonly sowRepository: SowRepository;
  readonly pendingEventStore: PendingEventStore;
  readonly pendingTtlSeconds?: number;
}

const DEFAULT_PENDING_TTL_SECONDS = 600;

/**
 * Stub progresivo mínimo (PLAN-v1.1.md §9, Corte 0): onboarding de una
 * cerda no registrada aún ("no tengo la 214, ¿la creo?"). La creación real
 * ocurre en ConfirmFarmEvent tras el "sí"; este caso de uso no se cablea
 * en HandleIncomingMessage hasta Corte 3 (cría individual), cuando el
 * extractor pueda señalar chapetas desconocidas desde el FarmContext.
 *
 * Nota de firma: el puerto PendingEventStore exige un OperatorId para
 * guardar el pending, así que se añade como primer parámetro (el enunciado
 * original solo mencionaba farmId/chapeta, insuficiente para el puerto).
 */
export class RegisterSow {
  private readonly pendingTtlSeconds: number;

  constructor(private readonly deps: RegisterSowDeps) {
    this.pendingTtlSeconds = deps.pendingTtlSeconds ?? DEFAULT_PENDING_TTL_SECONDS;
  }

  async handle(operatorId: OperatorId, farmId: FarmId, chapeta: string): Promise<FarmReply> {
    const existing = await this.deps.sowRepository.findByChapeta(farmId, chapeta);
    if (existing) {
      return { text: `Ya tengo registrada la cerda ${chapeta}.` };
    }

    await this.deps.pendingEventStore.savePending(
      operatorId,
      { kind: 'register_entity', entity: { entity: 'sow', chapeta } },
      this.pendingTtlSeconds,
    );
    return { text: `No tengo registrada la cerda ${chapeta}. ¿La creo?` };
  }
}
