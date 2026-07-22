import type { AppUser, AppUserId, IdentificationType } from '../../../src/domain/farm/app-user.js';
import type { Farm, FarmId } from '../../../src/domain/farm/farm.js';
import type { Operator, OperatorId, OperatorStatus } from '../../../src/domain/farm/operator.js';
import type { WorkerInvitation } from '../../../src/domain/farm/registration.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { err, ok } from '../../../src/domain/shared/result.js';
import type {
  FarmRepository,
  FarmSearchResult,
  OperatorWithFarm,
  PendingMembership,
} from '../../../src/application/ports/farm-repository.js';
import type { PersistenceError } from '../../../src/application/ports/persistence-error.js';
import { persistenceError } from '../../../src/application/ports/persistence-error.js';

function identificationKey(type: IdentificationType, number: string): string {
  return `${type}:${number}`;
}

export class FakeFarmRepository implements FarmRepository {
  readonly farmsById = new Map<string, Farm>();
  // Legacy v1.1: findOperatorByHash/saveOperator seguían resolviendo
  // directo por operator.channelUserHash. Se conserva para no romper los
  // tests/flujos de RegisterFarm/ConfirmFarmEvent (fuera de este spec).
  readonly operatorsByHash = new Map<string, Operator>();

  readonly usersById = new Map<AppUserId, AppUser>();
  readonly usersByIdentification = new Map<string, AppUserId>();
  readonly usersByHash = new Map<string, AppUserId>();
  // Identidad de chat probada por Telegram (hashed-zooming-flame.md, Tarea
  // 1): espacio separado de usersByHash (channel_user_hash), igual que en
  // Supabase (columna telegram_user_hash aparte).
  readonly usersByTelegramHash = new Map<string, AppUserId>();
  readonly usersByPhoneHash = new Map<string, AppUserId>();
  readonly operatorsById = new Map<OperatorId, Operator>();
  readonly invitationsByPhoneHash = new Map<string, WorkerInvitation>();

  /** Último hash recibido por findOperatorByHash (asserts de test de regresión). */
  lastLookupHash: string | undefined;

  /** Atajo de setup para tests: registra granja + operario de una vez (legacy v1.1). */
  seedOperator(farm: Farm, operator: Operator): void {
    this.farmsById.set(farm.id, farm);
    if (operator.channelUserHash !== undefined) {
      this.operatorsByHash.set(operator.channelUserHash, operator);
    }
    this.operatorsById.set(operator.id, operator);
  }

  /** Atajo de setup para tests de spec 001: registra persona + granja + membresía. */
  seedRegistration(user: AppUser, farm: Farm, operator: Operator): void {
    this.saveUser(user);
    this.farmsById.set(farm.id, farm);
    this.operatorsById.set(operator.id, operator);
  }

  async findOperatorByHash(channelUserHash: string): Promise<OperatorWithFarm | null> {
    this.lastLookupHash = channelUserHash;
    const legacy = this.operatorsByHash.get(channelUserHash);
    if (legacy) {
      const farm = this.farmsById.get(legacy.farmId);
      return farm ? { operator: legacy, farm } : null;
    }

    // Un único método sirve a los dos canales probados (hashed-zooming-flame.md,
    // Tarea 1): channel_user_hash (WhatsApp) o telegram_user_hash (Telegram).
    const userId = this.usersByHash.get(channelUserHash) ?? this.usersByTelegramHash.get(channelUserHash);
    if (userId === undefined) {
      return null;
    }
    const operator = [...this.operatorsById.values()].find(
      (o) => o.userId === userId && o.status === 'activo',
    );
    if (!operator) {
      return null;
    }
    const farm = this.farmsById.get(operator.farmId);
    return farm ? { operator, farm } : null;
  }

  async saveFarm(farm: Farm): Promise<Result<void, PersistenceError>> {
    this.farmsById.set(farm.id, farm);
    return ok(undefined);
  }

  async saveOperator(operator: Operator): Promise<Result<void, PersistenceError>> {
    if (operator.channelUserHash !== undefined) {
      this.operatorsByHash.set(operator.channelUserHash, operator);
    }
    this.operatorsById.set(operator.id, operator);
    return ok(undefined);
  }

  // ── Extensión spec 001 ───────────────────────────────────────────────

  async findUserByIdentification(
    identificationType: IdentificationType,
    identificationNumber: string,
  ): Promise<AppUser | null> {
    const userId = this.usersByIdentification.get(
      identificationKey(identificationType, identificationNumber),
    );
    return userId !== undefined ? (this.usersById.get(userId) ?? null) : null;
  }

  async findUserByHash(channelUserHash: string): Promise<AppUser | null> {
    const userId = this.usersByHash.get(channelUserHash);
    return userId !== undefined ? (this.usersById.get(userId) ?? null) : null;
  }

  async findUserByPhoneHash(phoneHash: string): Promise<AppUser | null> {
    const userId = this.usersByPhoneHash.get(phoneHash);
    return userId !== undefined ? (this.usersById.get(userId) ?? null) : null;
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
    const existing = this.usersById.get(userId);
    if (!existing) {
      return err(persistenceError(`usuario no encontrado: ${userId}`));
    }
    const updated: AppUser = {
      ...existing,
      ...(params.channelUserHash !== undefined ? { channelUserHash: params.channelUserHash } : {}),
      ...(params.telegramUserHash !== undefined
        ? { telegramUserHash: params.telegramUserHash }
        : {}),
      ...(params.phoneVerifiedAt !== undefined ? { phoneVerifiedAt: params.phoneVerifiedAt } : {}),
      ...(params.emailVerifiedAt !== undefined ? { emailVerifiedAt: params.emailVerifiedAt } : {}),
    };
    this.saveUser(updated);
    return ok(updated);
  }

  async findFarmById(farmId: FarmId): Promise<Farm | null> {
    return this.farmsById.get(farmId) ?? null;
  }

  async findFarmsByUser(userId: AppUserId): Promise<readonly OperatorWithFarm[]> {
    return [...this.operatorsById.values()]
      .filter((o) => o.userId === userId)
      .map((operator) => ({ operator, farm: this.farmsById.get(operator.farmId) }))
      .filter((x): x is OperatorWithFarm => x.farm !== undefined);
  }

  async searchFarms(query: string, limit: number): Promise<readonly FarmSearchResult[]> {
    const needle = query.trim().toLowerCase();
    return [...this.farmsById.values()]
      .filter(
        (farm) =>
          farm.name.toLowerCase().includes(needle) ||
          (farm.location?.toLowerCase().includes(needle) ?? false),
      )
      .slice(0, limit)
      .map((farm) => ({
        id: farm.id,
        name: farm.name,
        location: farm.location,
        adminName: this.findAdminDisplayName(farm.id),
      }));
  }

  async registerOwnerWithFarm(
    user: AppUser,
    farm: Farm,
    operator: Operator,
    invitations: readonly WorkerInvitation[],
  ): Promise<Result<OperatorWithFarm, PersistenceError>> {
    this.saveUser(user);
    this.farmsById.set(farm.id, farm);
    this.operatorsById.set(operator.id, operator);
    for (const invitation of invitations) {
      this.invitationsByPhoneHash.set(invitation.phoneHash, invitation);
    }
    return ok({ operator, farm });
  }

  async addFarmToExistingUser(
    userId: AppUserId,
    farm: Farm,
    operator: Operator,
    invitations: readonly WorkerInvitation[],
  ): Promise<Result<OperatorWithFarm, PersistenceError>> {
    if (!this.usersById.has(userId)) {
      return err(persistenceError(`usuario no encontrado: ${userId}`));
    }
    this.farmsById.set(farm.id, farm);
    this.operatorsById.set(operator.id, operator);
    for (const invitation of invitations) {
      this.invitationsByPhoneHash.set(invitation.phoneHash, invitation);
    }
    return ok({ operator, farm });
  }

  async registerWorkerRequest(
    user: AppUser,
    operator: Operator,
  ): Promise<Result<OperatorWithFarm, PersistenceError>> {
    const farm = this.farmsById.get(operator.farmId);
    if (!farm) {
      return err(persistenceError(`granja no encontrada: ${operator.farmId}`));
    }
    this.saveUser(user);
    this.operatorsById.set(operator.id, operator);
    if (user.channelUserHash !== undefined) {
      const invitation = this.invitationsByPhoneHash.get(user.channelUserHash);
      if (invitation && invitation.consumedAt === undefined) {
        this.invitationsByPhoneHash.set(user.channelUserHash, {
          ...invitation,
          consumedAt: operator.createdAt ?? new Date(),
        });
      }
    }
    return ok({ operator, farm });
  }

  async findPendingMemberships(farmId: FarmId): Promise<readonly PendingMembership[]> {
    return [...this.operatorsById.values()]
      .filter((o) => o.farmId === farmId && o.status === 'pendiente')
      .map((operator) => {
        const user = this.usersById.get(operator.userId);
        const farm = this.farmsById.get(operator.farmId);
        return user && farm ? { operator, user, farm } : undefined;
      })
      .filter((x): x is PendingMembership => x !== undefined);
  }

  async setMembershipStatus(
    operatorId: OperatorId,
    status: OperatorStatus,
  ): Promise<Result<void, PersistenceError>> {
    const existing = this.operatorsById.get(operatorId);
    if (!existing) {
      return err(persistenceError(`membresía no encontrada: ${operatorId}`));
    }
    this.operatorsById.set(operatorId, { ...existing, status, pendingExpiresAt: undefined });
    return ok(undefined);
  }

  async deleteMembership(operatorId: OperatorId): Promise<Result<void, PersistenceError>> {
    this.operatorsById.delete(operatorId);
    return ok(undefined);
  }

  async findInvitationByPhoneHash(phoneHash: string): Promise<WorkerInvitation | null> {
    return this.invitationsByPhoneHash.get(phoneHash) ?? null;
  }

  private saveUser(user: AppUser): void {
    this.usersById.set(user.id, user);
    this.usersByIdentification.set(
      identificationKey(user.identificationType, user.identificationNumber),
      user.id,
    );
    if (user.channelUserHash !== undefined) {
      this.usersByHash.set(user.channelUserHash, user.id);
    }
    if (user.telegramUserHash !== undefined) {
      this.usersByTelegramHash.set(user.telegramUserHash, user.id);
    }
    if (user.phoneHash.length > 0) {
      this.usersByPhoneHash.set(user.phoneHash, user.id);
    }
  }

  private findAdminDisplayName(farmId: FarmId): string | undefined {
    const admin = [...this.operatorsById.values()].find(
      (o) => o.farmId === farmId && o.role === 'administrador_dueno' && o.status === 'activo',
    );
    if (!admin) {
      return undefined;
    }
    return this.usersById.get(admin.userId)?.displayName;
  }
}
