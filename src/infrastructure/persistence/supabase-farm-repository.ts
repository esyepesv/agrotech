import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser, AppUserId, IdentificationType } from '../../domain/farm/app-user.js';
import { DEFAULT_META_PARTOS_POR_ANO, DEFAULT_REGION } from '../../domain/farm/farm.js';
import type { Farm, FarmId } from '../../domain/farm/farm.js';
import type {
  Operator,
  OperatorId,
  OperatorRole,
  OperatorStatus,
} from '../../domain/farm/operator.js';
import type { WorkerInvitation } from '../../domain/farm/registration.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type {
  FarmRepository,
  FarmSearchResult,
  OperatorWithFarm,
  PendingMembership,
} from '../../application/ports/farm-repository.js';
import type { PersistenceError } from '../../application/ports/persistence-error.js';
import { persistenceError } from '../../application/ports/persistence-error.js';

const FARM_TABLE = 'farm';
const OPERATOR_TABLE = 'operator';
const APP_USER_TABLE = 'app_user';
const WORKER_INVITATION_TABLE = 'worker_invitation';
const REGISTER_OWNER_RPC = 'register_owner_with_farm';
const REGISTER_WORKER_RPC = 'register_worker_membership';

interface FarmRow {
  readonly id: string;
  readonly name: string;
  readonly owner_name: string | null;
  readonly meta_partos_por_ano: number | null;
  readonly region: string | null;
  readonly created_at: string;
  readonly legal_type: string | null;
  readonly tax_id_type: string | null;
  readonly tax_id: string | null;
  readonly location: string | null;
  readonly ceba_capacity: number | null;
  readonly breeding_capacity: number | null;
  readonly total_capacity: number | null;
  readonly sanitary_registry: string | null;
}

interface OperatorRow {
  readonly id: string;
  readonly user_id: string | null;
  readonly farm_id: string;
  readonly channel_user_hash: string | null;
  readonly display_name: string | null;
  readonly role: string;
  readonly status: string;
  readonly pending_expires_at: string | null;
  readonly created_at: string | null;
}

interface AppUserRow {
  readonly id: string;
  readonly identification_type: string;
  readonly identification_number: string;
  readonly phone_hash: string | null;
  readonly channel_user_hash: string | null;
  readonly telegram_user_hash: string | null;
  readonly phone_verified_at: string | null;
  readonly email_verified_at: string | null;
  readonly email: string | null;
  readonly display_name: string | null;
  readonly created_at: string;
}

interface WorkerInvitationRow {
  readonly id: string;
  readonly farm_id: string;
  readonly display_name: string;
  readonly identification_number: string;
  readonly phone_hash: string;
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly consumed_at: string | null;
}

/**
 * Persiste Farm/Operator/AppUser/WorkerInvitation en Supabase (spec 001).
 * Solo traduce snake_case ↔ camelCase; la decisión de negocio (duplicados,
 * membresía existente, etc.) vive en los casos de uso.
 *
 * Atomicidad: Supabase JS no da transacciones multi-tabla. registerOwnerWithFarm
 * y addFarmToExistingUser delegan en la función RPC `register_owner_with_farm`
 * (0004_register_farm_and_user.sql); registerWorkerRequest delega en
 * `register_worker_membership`. Ambas son plpgsql — transaccionales por
 * defecto — así que AppUser + Farm + Operator (+ invitaciones) se crean
 * todos o ninguno.
 */
export class SupabaseFarmRepository implements FarmRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findOperatorByHash(channelUserHash: string): Promise<OperatorWithFarm | null> {
    // Camino v1.2: app_user.channel_user_hash / telegram_user_hash → operator
    // activo de esa persona. Un único método sirve a los dos canales
    // (hashed-zooming-flame.md, Tarea 1) sin cambiar la firma ni tocar a sus
    // llamadores de v1.1.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: userData } = await this.client
      .from(APP_USER_TABLE)
      .select('*')
      .or(`channel_user_hash.eq.${channelUserHash},telegram_user_hash.eq.${channelUserHash}`)
      .maybeSingle();
    if (userData !== null) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { data: operatorData } = await this.client
        .from(OPERATOR_TABLE)
        .select('*')
        .eq('user_id', (userData as AppUserRow).id)
        .eq('status', 'activo')
        .limit(1)
        .maybeSingle();
      if (operatorData !== null) {
        const operator = toOperator(operatorData as OperatorRow);
        const farm = await this.fetchFarm(operator.farmId);
        return farm ? { operator, farm } : null;
      }
    }

    // Camino legado v1.1: ConfirmFarmEvent (flujo anónimo de auto-alta,
    // intacto por la regla de oro) escribe channel_user_hash directo en
    // operator, sin crear un app_user. Se conserva este fallback para no
    // romper ese camino.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: legacyOperatorData, error: legacyError } = await this.client
      .from(OPERATOR_TABLE)
      .select('*')
      .eq('channel_user_hash', channelUserHash)
      .maybeSingle();
    if (legacyError !== null || legacyOperatorData === null) {
      return null;
    }
    const legacyOperator = toOperator(legacyOperatorData as OperatorRow);
    const farm = await this.fetchFarm(legacyOperator.farmId);
    return farm ? { operator: legacyOperator, farm } : null;
  }

  async saveFarm(farm: Farm): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client.from(FARM_TABLE).upsert(fromFarm(farm));
    if (error !== null) {
      return err(persistenceError(`fallo al guardar granja: ${error.message}`));
    }
    return ok(undefined);
  }

  async saveOperator(operator: Operator): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client.from(OPERATOR_TABLE).upsert(fromOperator(operator));
    if (error !== null) {
      return err(persistenceError(`fallo al guardar operario: ${error.message}`));
    }
    return ok(undefined);
  }

  // ── Extensión spec 001 ───────────────────────────────────────────────

  async findUserByIdentification(
    identificationType: IdentificationType,
    identificationNumber: string,
  ): Promise<AppUser | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(APP_USER_TABLE)
      .select('*')
      .eq('identification_type', identificationType)
      .eq('identification_number', identificationNumber)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    return toAppUser(data as AppUserRow);
  }

  async findUserByHash(channelUserHash: string): Promise<AppUser | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(APP_USER_TABLE)
      .select('*')
      .eq('channel_user_hash', channelUserHash)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    return toAppUser(data as AppUserRow);
  }

  async findUserByPhoneHash(phoneHash: string): Promise<AppUser | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(APP_USER_TABLE)
      .select('*')
      .eq('phone_hash', phoneHash)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    return toAppUser(data as AppUserRow);
  }

  async attachChatIdentity(
    userId: AppUserId,
    params: {
      readonly channelUserHash?: string;
      readonly telegramUserHash?: string;
      readonly phoneVerifiedAt?: Date;
      readonly emailVerifiedAt?: Date;
    },
  ): Promise<Result<AppUser, PersistenceError>> {
    const update: Record<string, string> = {};
    if (params.channelUserHash !== undefined) {
      update.channel_user_hash = params.channelUserHash;
    }
    if (params.telegramUserHash !== undefined) {
      update.telegram_user_hash = params.telegramUserHash;
    }
    if (params.phoneVerifiedAt !== undefined) {
      update.phone_verified_at = params.phoneVerifiedAt.toISOString();
    }
    if (params.emailVerifiedAt !== undefined) {
      update.email_verified_at = params.emailVerifiedAt.toISOString();
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(APP_USER_TABLE)
      .update(update)
      .eq('id', userId)
      .select('*')
      .maybeSingle();
    if (error !== null || data === null) {
      return err(
        persistenceError(`fallo al ligar identidad de chat: ${error?.message ?? 'no encontrado'}`),
      );
    }
    return ok(toAppUser(data as AppUserRow));
  }

  async findFarmById(farmId: FarmId): Promise<Farm | null> {
    return this.fetchFarm(farmId);
  }

  async findFarmsByUser(userId: AppUserId): Promise<readonly OperatorWithFarm[]> {
    const { data, error } = await this.client
      .from(OPERATOR_TABLE)
      .select('*')
      .eq('user_id', userId);
    if (error !== null || data === null) {
      return [];
    }
    const rows = data as OperatorRow[];
    const results: OperatorWithFarm[] = [];
    for (const row of rows) {
      const operator = toOperator(row);
      const farm = await this.fetchFarm(operator.farmId);
      if (farm) {
        results.push({ operator, farm });
      }
    }
    return results;
  }

  async searchFarms(query: string, limit: number): Promise<readonly FarmSearchResult[]> {
    const needle = `%${query.trim()}%`;
    const { data, error } = await this.client
      .from(FARM_TABLE)
      .select('*')
      .or(`name.ilike.${needle},location.ilike.${needle}`)
      .limit(limit);
    if (error !== null || data === null) {
      return [];
    }
    const rows = data as FarmRow[];
    const results: FarmSearchResult[] = [];
    for (const row of rows) {
      const adminName = await this.fetchAdminDisplayName(row.id);
      results.push({
        id: row.id,
        name: row.name,
        location: row.location ?? undefined,
        adminName,
      });
    }
    return results;
  }

  async registerOwnerWithFarm(
    user: AppUser,
    farm: Farm,
    operator: Operator,
    invitations: readonly WorkerInvitation[],
  ): Promise<Result<OperatorWithFarm, PersistenceError>> {
    const { error } = await this.client.rpc(REGISTER_OWNER_RPC, {
      payload: {
        existing_user_id: null,
        user: fromAppUser(user),
        farm: fromFarm(farm),
        operator: { id: operator.id, role: operator.role, status: operator.status },
        invitations: invitations.map(fromWorkerInvitation),
      },
    });
    if (error !== null) {
      return err(persistenceError(`fallo al registrar dueño y granja: ${error.message}`));
    }
    return ok({ operator, farm });
  }

  async addFarmToExistingUser(
    userId: AppUserId,
    farm: Farm,
    operator: Operator,
    invitations: readonly WorkerInvitation[],
  ): Promise<Result<OperatorWithFarm, PersistenceError>> {
    const { error } = await this.client.rpc(REGISTER_OWNER_RPC, {
      payload: {
        existing_user_id: userId,
        user: null,
        farm: fromFarm(farm),
        operator: { id: operator.id, role: operator.role, status: operator.status },
        invitations: invitations.map(fromWorkerInvitation),
      },
    });
    if (error !== null) {
      return err(persistenceError(`fallo al registrar granja adicional: ${error.message}`));
    }
    return ok({ operator, farm });
  }

  async registerWorkerRequest(
    user: AppUser,
    operator: Operator,
  ): Promise<Result<OperatorWithFarm, PersistenceError>> {
    const farm = await this.fetchFarm(operator.farmId);
    if (!farm) {
      return err(persistenceError(`granja no encontrada: ${operator.farmId}`));
    }
    const { error } = await this.client.rpc(REGISTER_WORKER_RPC, {
      payload: {
        existing_user_id: null,
        user: fromAppUser(user),
        channel_user_hash: user.channelUserHash ?? null,
        operator: {
          id: operator.id,
          farm_id: operator.farmId,
          role: operator.role,
          status: operator.status,
          pending_expires_at: operator.pendingExpiresAt?.toISOString() ?? null,
        },
      },
    });
    if (error !== null) {
      return err(persistenceError(`fallo al registrar solicitud de trabajador: ${error.message}`));
    }
    return ok({ operator, farm });
  }

  async findPendingMemberships(farmId: FarmId): Promise<readonly PendingMembership[]> {
    const { data, error } = await this.client
      .from(OPERATOR_TABLE)
      .select('*')
      .eq('farm_id', farmId)
      .eq('status', 'pendiente');
    if (error !== null || data === null) {
      return [];
    }
    const rows = data as OperatorRow[];
    const results: PendingMembership[] = [];
    for (const row of rows) {
      const operator = toOperator(row);
      if (operator.userId === '') {
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { data: userData } = await this.client
        .from(APP_USER_TABLE)
        .select('*')
        .eq('id', operator.userId)
        .maybeSingle();
      const farm = await this.fetchFarm(farmId);
      if (userData !== null && farm) {
        results.push({ operator, user: toAppUser(userData as AppUserRow), farm });
      }
    }
    return results;
  }

  async setMembershipStatus(
    operatorId: OperatorId,
    status: OperatorStatus,
  ): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client
      .from(OPERATOR_TABLE)
      .update({ status, pending_expires_at: null })
      .eq('id', operatorId);
    if (error !== null) {
      return err(persistenceError(`fallo al cambiar el estado de la membresía: ${error.message}`));
    }
    return ok(undefined);
  }

  async deleteMembership(operatorId: OperatorId): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client.from(OPERATOR_TABLE).delete().eq('id', operatorId);
    if (error !== null) {
      return err(persistenceError(`fallo al eliminar la membresía: ${error.message}`));
    }
    return ok(undefined);
  }

  async findInvitationByPhoneHash(phoneHash: string): Promise<WorkerInvitation | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(WORKER_INVITATION_TABLE)
      .select('*')
      .eq('phone_hash', phoneHash)
      .is('consumed_at', null)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    return toWorkerInvitation(data as WorkerInvitationRow);
  }

  private async fetchFarm(farmId: FarmId): Promise<Farm | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(FARM_TABLE)
      .select('*')
      .eq('id', farmId)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    return toFarm(data as FarmRow);
  }

  private async fetchAdminDisplayName(farmId: FarmId): Promise<string | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: operatorData } = await this.client
      .from(OPERATOR_TABLE)
      .select('*')
      .eq('farm_id', farmId)
      .eq('role', 'administrador_dueno')
      .eq('status', 'activo')
      .limit(1)
      .maybeSingle();
    if (operatorData === null) {
      return undefined;
    }
    const operator = toOperator(operatorData as OperatorRow);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: userData } = await this.client
      .from(APP_USER_TABLE)
      .select('*')
      .eq('id', operator.userId)
      .maybeSingle();
    return userData === null
      ? undefined
      : (toAppUser(userData as AppUserRow).displayName ?? undefined);
  }
}

function toFarm(row: FarmRow): Farm {
  return {
    id: row.id,
    name: row.name,
    ownerName: row.owner_name ?? undefined,
    config: {
      metaPartosPorAno: row.meta_partos_por_ano ?? DEFAULT_META_PARTOS_POR_ANO,
      region: row.region ?? DEFAULT_REGION,
    },
    createdAt: new Date(row.created_at),
    legalType: toLegalType(row.legal_type),
    taxIdType: toTaxIdType(row.tax_id_type),
    taxId: row.tax_id ?? undefined,
    location: row.location ?? undefined,
    cebaCapacity: row.ceba_capacity ?? undefined,
    breedingCapacity: row.breeding_capacity ?? undefined,
    totalCapacity: row.total_capacity ?? undefined,
    sanitaryRegistry: row.sanitary_registry ?? undefined,
  };
}

function fromFarm(farm: Farm): FarmRow {
  return {
    id: farm.id,
    name: farm.name,
    owner_name: farm.ownerName ?? null,
    meta_partos_por_ano: farm.config.metaPartosPorAno,
    region: farm.config.region,
    created_at: farm.createdAt.toISOString(),
    legal_type: farm.legalType ?? null,
    tax_id_type: farm.taxIdType ?? null,
    tax_id: farm.taxId ?? null,
    location: farm.location ?? null,
    ceba_capacity: farm.cebaCapacity ?? null,
    breeding_capacity: farm.breedingCapacity ?? null,
    total_capacity: farm.totalCapacity ?? null,
    sanitary_registry: farm.sanitaryRegistry ?? null,
  };
}

function toLegalType(value: string | null): Farm['legalType'] {
  return value === 'natural' || value === 'juridica' ? value : undefined;
}

function toTaxIdType(value: string | null): Farm['taxIdType'] {
  return value === 'cedula' || value === 'nit' ? value : undefined;
}

function toOperator(row: OperatorRow): Operator {
  return {
    id: row.id,
    userId: row.user_id ?? '',
    farmId: row.farm_id,
    channelUserHash: row.channel_user_hash ?? undefined,
    displayName: row.display_name ?? undefined,
    role: toOperatorRole(row.role),
    status: toOperatorStatus(row.status),
    pendingExpiresAt: row.pending_expires_at ? new Date(row.pending_expires_at) : undefined,
    createdAt: row.created_at ? new Date(row.created_at) : undefined,
  };
}

function fromOperator(operator: Operator): OperatorRow {
  return {
    id: operator.id,
    user_id: operator.userId === '' ? null : operator.userId,
    farm_id: operator.farmId,
    channel_user_hash: operator.channelUserHash ?? null,
    display_name: operator.displayName ?? null,
    role: operator.role,
    status: operator.status,
    pending_expires_at: operator.pendingExpiresAt?.toISOString() ?? null,
    created_at: operator.createdAt?.toISOString() ?? null,
  };
}

// La columna `role` es `text` con check constraint desde la migración 0004;
// antes de aplicarla puede haber valores legados ('admin'/'operario') en
// filas viejas. Si llega un valor fuera de la unión nueva, se degrada al rol
// de menor privilegio en vez de lanzar.
function toOperatorRole(role: string): OperatorRole {
  return role === 'administrador_dueno' ? 'administrador_dueno' : 'trabajador';
}

function toOperatorStatus(status: string): OperatorStatus {
  return status === 'pendiente' ? 'pendiente' : 'activo';
}

function toAppUser(row: AppUserRow): AppUser {
  return {
    id: row.id,
    identificationType: toIdentificationType(row.identification_type),
    identificationNumber: row.identification_number,
    // row.phone_hash ?? '' cubre filas de antes de la migración 0006
    // (columna aún no aplicada/poblada); AppUser.phoneHash es obligatorio.
    phoneHash: row.phone_hash ?? '',
    channelUserHash: row.channel_user_hash ?? undefined,
    telegramUserHash: row.telegram_user_hash ?? undefined,
    phoneVerifiedAt: row.phone_verified_at ? new Date(row.phone_verified_at) : undefined,
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at) : undefined,
    // row.email ?? '' cubre filas de antes de la migración 0006 (columna
    // aún no NOT NULL/poblada); AppUser.email es obligatorio.
    email: row.email ?? '',
    displayName: row.display_name ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

function fromAppUser(user: AppUser): AppUserRow {
  return {
    id: user.id,
    identification_type: user.identificationType,
    identification_number: user.identificationNumber,
    phone_hash: user.phoneHash,
    channel_user_hash: user.channelUserHash ?? null,
    telegram_user_hash: user.telegramUserHash ?? null,
    phone_verified_at: user.phoneVerifiedAt?.toISOString() ?? null,
    email_verified_at: user.emailVerifiedAt?.toISOString() ?? null,
    email: user.email ?? null,
    display_name: user.displayName ?? null,
    created_at: user.createdAt.toISOString(),
  };
}

function toIdentificationType(value: string): IdentificationType {
  return value === 'CE' || value === 'PA' ? value : 'CC';
}

function toWorkerInvitation(row: WorkerInvitationRow): WorkerInvitation {
  return {
    id: row.id,
    farmId: row.farm_id,
    displayName: row.display_name,
    identificationNumber: row.identification_number,
    phoneHash: row.phone_hash,
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : undefined,
  };
}

function fromWorkerInvitation(invitation: WorkerInvitation): WorkerInvitationRow {
  return {
    id: invitation.id,
    farm_id: invitation.farmId,
    display_name: invitation.displayName,
    identification_number: invitation.identificationNumber,
    phone_hash: invitation.phoneHash,
    created_at: invitation.createdAt.toISOString(),
    expires_at: invitation.expiresAt?.toISOString() ?? null,
    consumed_at: invitation.consumedAt?.toISOString() ?? null,
  };
}
