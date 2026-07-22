import type { AppUser, AppUserId } from '../../domain/farm/app-user.js';
import { DEFAULT_META_PARTOS_POR_ANO, DEFAULT_REGION } from '../../domain/farm/farm.js';
import type { Farm, FarmId } from '../../domain/farm/farm.js';
import type { Operator, OperatorStatus } from '../../domain/farm/operator.js';
import type {
  FarmInput,
  NormalizedUserInput,
  NormalizedWorkerInvitationInput,
  RegisterFarmAndUserInput,
  RegisterOwnerInput,
  RegisterWorkerInput,
  RegistrationError,
  WorkerInvitation,
} from '../../domain/farm/registration.js';
import {
  validateFarmInput,
  validateUserInput,
  validateWorkerInvitationInput,
} from '../../domain/farm/registration.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { Clock } from '../ports/clock.js';
import type { FarmRepository } from '../ports/farm-repository.js';

export interface RegisterFarmAndUserDeps {
  readonly farmRepository: FarmRepository;
  readonly clock: Clock;
  // application no importa node:crypto (regla hexagonal, mismo patrón que
  // ConfirmFarmEvent): el id lo genera quien construye el caso de uso.
  readonly idGenerator: () => string;
  // Mismo hasheo con sal secreta (HMAC + USER_ID_SALT) que v1/v1.1; aquí se
  // aplica siempre al celular normalizado (E.164), que es la identidad de
  // canal tanto en chat (channelUserId) como en web (celular verificado
  // por OTP en el adaptador, no aquí).
  readonly hashUserId: (raw: string) => string;
}

export interface RegistrationOutcome {
  readonly user: AppUser;
  readonly farm: Farm;
  readonly operator: Operator;
  readonly membershipStatus: OperatorStatus;
}

const DUPLICATE_IDENTIFICATION_MESSAGE = 'Ya existe una cuenta con esa identificación.';
const DUPLICATE_FARM_MESSAGE = 'Esa finca ya está registrada en tu cuenta.';
const FARM_NOT_FOUND_MESSAGE = 'No encontramos esa finca.';
const ALREADY_MEMBER_MESSAGE = 'Ya tienes una solicitud/membresía en esa finca.';

// Expiración de membresías 'pendiente' (spec 001 §5); la limpieza es
// perezosa (ApproveWorker.listPending filtra por esta fecha), igual que
// pending_event en v1.1 — no hay job de fondo.
const PENDING_MEMBERSHIP_TTL_HOURS = 72;

/**
 * Puerta de entrada al eje de datos (spec 001 §1/§4.3): crea AppUser + Farm
 * + Operator de forma atómica (dueño) o solo la membresía (trabajador).
 * Puro dominio orquestado — NO verifica OTP (responsabilidad del adaptador
 * web) y NO sabe de conversaciones/PendingEventStore (responsabilidad del
 * adaptador de chat); arquitectura-v1.2.md §7.
 */
export class RegisterFarmAndUser {
  constructor(private readonly deps: RegisterFarmAndUserDeps) {}

  async submit(
    input: RegisterFarmAndUserInput,
  ): Promise<Result<RegistrationOutcome, RegistrationError>> {
    const userValidation = validateUserInput(input.user);
    if (!userValidation.ok) {
      return userValidation;
    }
    const user = userValidation.value;
    // El hash SIEMPRE se calcula (se necesita para comparar/completar
    // identidad), pero solo se ESCRIBE en un AppUser cuando phoneVerified es
    // true (spec 001 §4.3): ver buildNewAppUser/resolveExistingUser.
    const channelUserHash = this.deps.hashUserId(user.phone);
    const now = this.deps.clock.now();

    const existingUser = await this.deps.farmRepository.findUserByIdentification(
      user.identificationType,
      user.identificationNumber,
    );
    // Identificación ya registrada por OTRA persona (hash de canal YA
    // ATADO y distinto, p. ej. otro celular): se rechaza (spec 001 §5). Si
    // el existente no tiene hash todavía (se registró solo con correo), no
    // es un conflicto: se completa más abajo si este intento sí verificó el
    // celular.
    if (
      existingUser !== null &&
      existingUser.channelUserHash !== undefined &&
      existingUser.channelUserHash !== channelUserHash
    ) {
      return err({ kind: 'duplicate_identification', message: DUPLICATE_IDENTIFICATION_MESSAGE });
    }

    const resolvedExisting = await this.resolveExistingUser(
      existingUser,
      user,
      channelUserHash,
      now,
    );
    if (!resolvedExisting.ok) {
      return err(resolvedExisting.error);
    }

    if (input.kind === 'owner') {
      return this.submitOwner(input, user, channelUserHash, resolvedExisting.value, now);
    }
    return this.submitWorker(input, channelUserHash, resolvedExisting.value, user, now);
  }

  /**
   * Si la persona ya existía sin hash de canal (channel_user_hash nulo: se
   * registró verificando solo el correo) y este intento SÍ trae el celular
   * verificado, se completa su identidad de chat ahora — spec 001 §4.3:
   * "Usuario que solo verificó el correo ... tras lo cual queda vinculado a
   * su cuenta existente". Nunca se sobreescribe un hash ya atado (ese caso
   * ya fue rechazado como duplicate_identification arriba). Antes lo hacía
   * attachVerifiedPhone; ahora attachChatIdentity (hashed-zooming-flame.md,
   * Tarea 1), mismo propósito con las columnas separadas de AppUser.
   */
  private async resolveExistingUser(
    existingUser: AppUser | null,
    user: NormalizedUserInput,
    channelUserHash: string,
    now: Date,
  ): Promise<Result<AppUser | null, RegistrationError>> {
    if (
      existingUser === null ||
      existingUser.channelUserHash !== undefined ||
      !user.phoneVerified
    ) {
      return ok(existingUser);
    }
    const attached = await this.deps.farmRepository.attachChatIdentity(existingUser.id, {
      channelUserHash,
      phoneVerifiedAt: now,
    });
    if (!attached.ok) {
      return err({ kind: 'persistence', message: attached.error.message });
    }
    return ok(attached.value);
  }

  private async submitOwner(
    input: RegisterOwnerInput,
    user: NormalizedUserInput,
    channelUserHash: string,
    existingUser: AppUser | null,
    now: Date,
  ): Promise<Result<RegistrationOutcome, RegistrationError>> {
    const farmValidation = validateFarmInput(input.farm);
    if (!farmValidation.ok) {
      return farmValidation;
    }
    const farm = farmValidation.value;

    const normalizedWorkers: NormalizedWorkerInvitationInput[] = [];
    for (const [index, worker] of (input.workers ?? []).entries()) {
      const workerValidation = validateWorkerInvitationInput(worker, index);
      if (!workerValidation.ok) {
        return workerValidation;
      }
      normalizedWorkers.push(workerValidation.value);
    }

    if (existingUser !== null) {
      // Multi-granja (arquitectura-v1.2.md §5): misma persona (mismo hash)
      // da de alta OTRA finca; solo se bloquea si es la MISMA (tax_id + nombre).
      const existingFarms = await this.deps.farmRepository.findFarmsByUser(existingUser.id);
      const duplicate = existingFarms.some(
        (f) => f.farm.taxId === farm.taxId && sameName(f.farm.name, farm.name),
      );
      if (duplicate) {
        return err({ kind: 'duplicate_farm', message: DUPLICATE_FARM_MESSAGE });
      }

      const newFarm = this.buildFarm(farm, now);
      const newOperator = this.buildOwnerOperator(existingUser.id, newFarm.id, now);
      const invitations = this.buildInvitations(normalizedWorkers, newFarm.id, now);

      const result = await this.deps.farmRepository.addFarmToExistingUser(
        existingUser.id,
        newFarm,
        newOperator,
        invitations,
      );
      if (!result.ok) {
        return err({ kind: 'persistence', message: result.error.message });
      }
      return ok({
        user: existingUser,
        farm: result.value.farm,
        operator: result.value.operator,
        membershipStatus: result.value.operator.status,
      });
    }

    // Persona nueva: AppUser + Farm + Operator se crean todos o ninguno.
    const newUser: AppUser = this.buildNewAppUser(user, channelUserHash, now);
    const newFarm = this.buildFarm(farm, now);
    const newOperator = this.buildOwnerOperator(newUser.id, newFarm.id, now);
    const invitations = this.buildInvitations(normalizedWorkers, newFarm.id, now);

    const result = await this.deps.farmRepository.registerOwnerWithFarm(
      newUser,
      newFarm,
      newOperator,
      invitations,
    );
    if (!result.ok) {
      return err({ kind: 'persistence', message: result.error.message });
    }
    return ok({
      user: newUser,
      farm: result.value.farm,
      operator: result.value.operator,
      membershipStatus: result.value.operator.status,
    });
  }

  private async submitWorker(
    input: RegisterWorkerInput,
    channelUserHash: string,
    existingUser: AppUser | null,
    user: NormalizedUserInput,
    now: Date,
  ): Promise<Result<RegistrationOutcome, RegistrationError>> {
    const farm = await this.deps.farmRepository.findFarmById(input.farmId);
    if (farm === null) {
      return err({ kind: 'farm_not_found', message: FARM_NOT_FOUND_MESSAGE });
    }

    if (existingUser !== null) {
      const memberships = await this.deps.farmRepository.findFarmsByUser(existingUser.id);
      const already = memberships.find((m) => m.farm.id === input.farmId);
      if (already) {
        return err({
          kind: 'already_member',
          message: ALREADY_MEMBER_MESSAGE,
          farmName: already.farm.name,
        });
      }
    }

    // Invitación previa del dueño (mismo phoneHash = mismo mecanismo de
    // hasheo que la identidad de canal): membresía activa sin aprobación;
    // si no hay invitación (o ya fue consumida), queda pendiente.
    const invitation = await this.deps.farmRepository.findInvitationByPhoneHash(channelUserHash);
    const matchedInvitation = invitation !== null && invitation.consumedAt === undefined;
    const status: OperatorStatus = matchedInvitation ? 'activo' : 'pendiente';

    const appUser: AppUser =
      existingUser ??
      this.buildNewAppUser(
        { ...user, displayName: user.displayName ?? invitation?.displayName },
        channelUserHash,
        now,
      );

    const operator: Operator = {
      id: this.deps.idGenerator(),
      userId: appUser.id,
      farmId: input.farmId,
      role: 'trabajador',
      status,
      createdAt: now,
      ...(status === 'pendiente'
        ? { pendingExpiresAt: addHours(now, PENDING_MEMBERSHIP_TTL_HOURS) }
        : {}),
    };

    const result = await this.deps.farmRepository.registerWorkerRequest(appUser, operator);
    if (!result.ok) {
      return err({ kind: 'persistence', message: result.error.message });
    }
    return ok({
      user: appUser,
      farm: result.value.farm,
      operator: result.value.operator,
      membershipStatus: result.value.operator.status,
    });
  }

  /**
   * phoneHash SIEMPRE se escribe (de qué celular dijo ser dueño); es la
   * regla NUEVA (hashed-zooming-flame.md, Tarea 1) que hace posible
   * reconocer luego el emparejamiento de invitaciones sin exigir OTP.
   *
   * channelUserHash sigue la regla única de spec 001 §4.3, que NO cambia de
   * lugar: SOLO se escribe si el celular quedó verificado
   * (user.phoneVerified); si no, queda nulo (la persona se registró
   * verificando solo el correo, o dio un celular distinto al detectado por
   * el canal sin completar el OTP) y se completa después vía
   * resolveExistingUser/attachChatIdentity.
   */
  private buildNewAppUser(user: NormalizedUserInput, channelUserHash: string, now: Date): AppUser {
    return {
      id: this.deps.idGenerator(),
      identificationType: user.identificationType,
      identificationNumber: user.identificationNumber,
      phoneHash: channelUserHash,
      channelUserHash: user.phoneVerified ? channelUserHash : undefined,
      phoneVerifiedAt: user.phoneVerified ? now : undefined,
      emailVerifiedAt: user.emailVerified ? now : undefined,
      email: user.email,
      displayName: user.displayName,
      createdAt: now,
    };
  }

  private buildFarm(farm: FarmInput, now: Date): Farm {
    return {
      id: this.deps.idGenerator(),
      name: farm.name,
      legalType: farm.legalType,
      taxIdType: farm.taxIdType,
      taxId: farm.taxId,
      location: farm.location,
      cebaCapacity: farm.cebaCapacity,
      breedingCapacity: farm.breedingCapacity,
      totalCapacity: farm.totalCapacity,
      sanitaryRegistry: farm.sanitaryRegistry,
      config: { metaPartosPorAno: DEFAULT_META_PARTOS_POR_ANO, region: DEFAULT_REGION },
      createdAt: now,
    };
  }

  private buildOwnerOperator(userId: AppUserId, farmId: FarmId, now: Date): Operator {
    return {
      id: this.deps.idGenerator(),
      userId,
      farmId,
      role: 'administrador_dueno',
      status: 'activo',
      createdAt: now,
    };
  }

  private buildInvitations(
    workers: readonly NormalizedWorkerInvitationInput[],
    farmId: FarmId,
    now: Date,
  ): readonly WorkerInvitation[] {
    return workers.map((w) => ({
      id: this.deps.idGenerator(),
      farmId,
      displayName: w.displayName,
      identificationNumber: w.identificationNumber,
      phoneHash: this.deps.hashUserId(w.phone),
      createdAt: now,
    }));
  }
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
