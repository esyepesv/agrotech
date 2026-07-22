import type { FarmId } from '../../domain/farm/farm.js';
import type { Operator, OperatorId } from '../../domain/farm/operator.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { Clock } from '../ports/clock.js';
import type { FarmRepository, PendingMembership } from '../ports/farm-repository.js';

export interface ApproveWorkerDeps {
  readonly farmRepository: FarmRepository;
  readonly clock: Clock;
}

export type ApproveWorkerError =
  | { readonly kind: 'not_authorized'; readonly message: string }
  | { readonly kind: 'not_found'; readonly message: string }
  | { readonly kind: 'persistence'; readonly message: string };

const NOT_AUTHORIZED_MESSAGE =
  'Solo el administrador activo de la finca puede aprobar o rechazar solicitudes.';
const NOT_FOUND_MESSAGE = 'No encontré esa solicitud pendiente.';

/**
 * El dueño resuelve solicitudes de trabajadores (spec 001 §4.1 punto 9,
 * §4.3). El `approver` viaja ya resuelto por quien llama (mismo patrón que
 * ConfirmFarmEvent: HandleIncomingMessage ya hizo findOperatorByHash antes
 * de llegar aquí) — evita otra vuelta al repositorio solo para reconfirmar
 * quién escribe. La firma real toma DOS ids (quien aprueba y a quién) en
 * vez del `resolve(operatorId, decision)` abreviado del spec, porque
 * verificar rol+status del aprobador exige conocerlo (ver informe final).
 */
export class ApproveWorker {
  constructor(private readonly deps: ApproveWorkerDeps) {}

  /** Lista solicitudes pendientes de una granja, descartando (perezosamente) las vencidas (72h, §5). */
  async listPending(farmId: FarmId): Promise<readonly PendingMembership[]> {
    const pending = await this.deps.farmRepository.findPendingMemberships(farmId);
    const now = this.deps.clock.now();
    return pending.filter(
      (p) => p.operator.pendingExpiresAt === undefined || p.operator.pendingExpiresAt > now,
    );
  }

  async resolve(
    approver: Operator,
    targetOperatorId: OperatorId,
    decision: 'aprobar' | 'rechazar',
  ): Promise<Result<void, ApproveWorkerError>> {
    if (approver.role !== 'administrador_dueno' || approver.status !== 'activo') {
      return err({ kind: 'not_authorized', message: NOT_AUTHORIZED_MESSAGE });
    }

    const pending = await this.listPending(approver.farmId);
    const target = pending.find((p) => p.operator.id === targetOperatorId);
    if (!target) {
      return err({ kind: 'not_found', message: NOT_FOUND_MESSAGE });
    }

    if (decision === 'rechazar') {
      // Se borra (no se marca 'rechazada'): así el trabajador puede volver a
      // solicitar sin quedar bloqueado por un estado terminal.
      const deleted = await this.deps.farmRepository.deleteMembership(targetOperatorId);
      if (!deleted.ok) {
        return err({ kind: 'persistence', message: deleted.error.message });
      }
      return ok(undefined);
    }

    const approved = await this.deps.farmRepository.setMembershipStatus(targetOperatorId, 'activo');
    if (!approved.ok) {
      return err({ kind: 'persistence', message: approved.error.message });
    }
    return ok(undefined);
  }
}
