import type { Clock } from '../ports/clock.js';
import type { FarmRepository } from '../ports/farm-repository.js';
import type { PendingEventStore } from '../ports/pending-event-store.js';
import type { FarmReply } from './farm-reply.js';

export interface RegisterFarmDeps {
  readonly farmRepository: FarmRepository;
  readonly pendingEventStore: PendingEventStore;
  readonly clock: Clock;
  readonly idGenerator: () => string;
  readonly pendingTtlSeconds?: number;
}

const DEFAULT_PENDING_TTL_SECONDS = 600;

const ASK_NAME_MESSAGE = '¿Cómo se llama tu granja?';

/**
 * Alta de granja por auto-servicio (P4 de PLAN-v1.1.md, piloto). Corte 0
 * cubre el camino feliz: nombre-en-el-texto → pending → confirmación
 * ("¿Creo tu granja con el nombre...? Di sí para confirmar."). La
 * confirmación real (ConfirmFarmEvent) requiere un operario ya existente
 * para llamarse (ver HandleIncomingMessage), así que en Corte 0 este
 * pending queda como intención registrada pero su cierre end-to-end para
 * un usuario totalmente anónimo llega con la persistencia real de
 * Corte 1 (identidad + container). idGenerator queda inyectado para
 * cuando el flujo completo cablee la creación aquí mismo si hiciera falta.
 *
 * TODO(Corte 1): flujo multi-turno completo (si el texto no trae nombre,
 * guardar un pending vacío y completarlo en el siguiente turno).
 */
export class RegisterFarm {
  private readonly pendingTtlSeconds: number;

  constructor(private readonly deps: RegisterFarmDeps) {
    this.pendingTtlSeconds = deps.pendingTtlSeconds ?? DEFAULT_PENDING_TTL_SECONDS;
  }

  async handle(channelUserHash: string, text: string): Promise<FarmReply> {
    const existing = await this.deps.farmRepository.findOperatorByHash(channelUserHash);
    if (existing) {
      return {
        text:
          `Ya tienes registrada la granja "${existing.farm.name}". ` +
          'Puedes decirme "compré 10 bultos de concentrado" o "¿cuánto me queda?".',
      };
    }

    const name = cleanFarmName(text);
    if (name.length === 0) {
      return { text: ASK_NAME_MESSAGE };
    }

    // La confirmación se guarda con el hash como clave (aún no hay
    // OperatorId real): PendingEventStore solo exige un string.
    await this.deps.pendingEventStore.savePending(
      channelUserHash,
      { kind: 'register_entity', entity: { entity: 'farm', name } },
      this.pendingTtlSeconds,
    );
    return { text: `¿Creo tu granja con el nombre "${name}"? Di sí para confirmar.` };
  }
}

function cleanFarmName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export const REGISTER_FARM_MESSAGES = {
  askName: ASK_NAME_MESSAGE,
} as const;
