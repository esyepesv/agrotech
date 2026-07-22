import type { AppUser, AppUserId, IdentificationType } from '../../domain/farm/app-user.js';
import type { Farm, FarmId } from '../../domain/farm/farm.js';
import type { Operator, OperatorId, OperatorStatus } from '../../domain/farm/operator.js';
import type { WorkerInvitation } from '../../domain/farm/registration.js';
import type { Result } from '../../domain/shared/result.js';
import type { PersistenceError } from './persistence-error.js';

export interface OperatorWithFarm {
  readonly operator: Operator;
  readonly farm: Farm;
}

// Solicitud de membresía en estado 'pendiente' junto con la persona y la
// granja, lo suficiente para que ApproveWorker arme el mensaje de
// aprobación ("Fulano (CC ...) pide unirse a Finca ...") sin otra vuelta al
// repositorio.
export interface PendingMembership {
  readonly operator: Operator;
  readonly user: AppUser;
  readonly farm: Farm;
}

// Resultado de búsqueda pública de fincas (spec 001, nota de privacidad
// final): nunca incluye identificación ni teléfono.
export interface FarmSearchResult {
  readonly id: FarmId;
  readonly name: string;
  readonly location?: string;
  readonly adminName?: string;
}

export interface FarmRepository {
  // Resuelve identidad a partir del hash del canal (HMAC con USER_ID_SALT,
  // D2 de PLAN-v1.1.md); null si el operario no está registrado. En v1.2 la
  // resolución real pasa por app_user.channel_user_hash (el hash ya no vive
  // en operator, ver operator.ts); la firma se conserva igual para no
  // romper HandleIncomingMessage/ConfirmFarmEvent (v1.1, intactos).
  findOperatorByHash(channelUserHash: string): Promise<OperatorWithFarm | null>;
  saveFarm(farm: Farm): Promise<Result<void, PersistenceError>>;
  saveOperator(operator: Operator): Promise<Result<void, PersistenceError>>;

  // ── Extensión spec 001 (registro de usuario + granja) ──────────────────
  findUserByIdentification(
    identificationType: IdentificationType,
    identificationNumber: string,
  ): Promise<AppUser | null>;
  findUserByHash(channelUserHash: string): Promise<AppUser | null>;
  // Completa la identidad de chat de una persona que ya existía sin ella
  // (se registró verificando solo el correo, channel_user_hash nulo) cuando
  // por fin verifica su celular (spec 001 §4.3, tabla de errores: "Usuario
  // que solo verificó el correo y luego escribe por WhatsApp"). No está en
  // la lista original de métodos del spec — extensión aditiva mínima
  // necesaria para esa regla (ver informe final).
  attachVerifiedPhone(
    userId: AppUserId,
    channelUserHash: string,
    verifiedAt: Date,
  ): Promise<Result<AppUser, PersistenceError>>;
  // No estaba en la lista original de métodos del spec, pero es
  // indispensable para detectar 'farm_not_found' al registrar un trabajador
  // por farmId: extensión aditiva mínima, mismo espíritu que el resto del
  // puerto (ver informe final).
  findFarmById(farmId: FarmId): Promise<Farm | null>;
  findFarmsByUser(userId: AppUserId): Promise<readonly OperatorWithFarm[]>;
  searchFarms(query: string, limit: number): Promise<readonly FarmSearchResult[]>;

  // Atómico: Supabase JS no da transacciones multi-tabla. Ambos métodos
  // delegan en la función RPC de Postgres `register_owner_with_farm`
  // (0004_register_farm_and_user.sql) — una función plpgsql es transaccional
  // por defecto, así que AppUser + Farm + Operator (+ invitaciones) se crean
  // todos o ninguno.
  registerOwnerWithFarm(
    user: AppUser,
    farm: Farm,
    operator: Operator,
    invitations: readonly WorkerInvitation[],
  ): Promise<Result<OperatorWithFarm, PersistenceError>>;
  addFarmToExistingUser(
    userId: AppUserId,
    farm: Farm,
    operator: Operator,
    invitations: readonly WorkerInvitation[],
  ): Promise<Result<OperatorWithFarm, PersistenceError>>;

  // Trabajador por solicitud o por invitación: crea el AppUser si no existe
  // y el Operator (membresía) en una sola transacción vía RPC
  // `register_worker_membership`. Si el celular coincide con una invitación
  // pendiente, la RPC la marca consumida en la misma transacción.
  registerWorkerRequest(
    user: AppUser,
    operator: Operator,
  ): Promise<Result<OperatorWithFarm, PersistenceError>>;

  findPendingMemberships(farmId: FarmId): Promise<readonly PendingMembership[]>;
  setMembershipStatus(
    operatorId: OperatorId,
    status: OperatorStatus,
  ): Promise<Result<void, PersistenceError>>;
  // Rechazo de solicitud (ApproveWorker.resolve): se borra la membresía en
  // vez de marcarla 'rechazada' para que el trabajador pueda volver a
  // solicitar sin quedar bloqueado por un estado terminal (decisión
  // documentada en el informe final; no había método explícito para esto
  // en la lista original del spec).
  deleteMembership(operatorId: OperatorId): Promise<Result<void, PersistenceError>>;
  findInvitationByPhoneHash(phoneHash: string): Promise<WorkerInvitation | null>;
}
