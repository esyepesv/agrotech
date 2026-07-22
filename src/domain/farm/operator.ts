import type { AppUserId } from './app-user.js';
import type { FarmId } from './farm.js';

export type OperatorId = string;

export type OperatorRole = 'administrador_dueno' | 'trabajador';

export type OperatorStatus = 'activo' | 'pendiente';

// Membresía usuario × granja × rol (v1.2 separa identidad de persona —
// AppUser, ver app-user.ts — de la pertenencia a una granja concreta;
// arquitectura-v1.2.md §5). Única por (userId, farmId).
//
// channelUserHash queda como campo OPCIONAL Y DEPRECADO: en v1.1 era la
// llave de identidad (un operario = un hash). En v1.2 esa llave vive en
// AppUser.channelUserHash y se resuelve indirectamente (operator.userId →
// app_user.channel_user_hash). Se conserva aquí (en vez de retirarlo) solo
// porque el flujo legado de auto-alta de v1.1 (RegisterFarm/ConfirmFarmEvent,
// intactos por la regla de oro) construye un Operator directamente sin pasar
// por RegisterFarmAndUser ni crear un AppUser real; quitarlo habría obligado
// a reescribir ese flujo, que no es parte de este spec. Se retira cuando ese
// camino se reemplace por el wizard conversacional de spec 001.
export interface Operator {
  readonly id: OperatorId;
  readonly userId: AppUserId;
  readonly farmId: FarmId;
  readonly role: OperatorRole;
  readonly status: OperatorStatus;
  // Expiración perezosa de membresías 'pendiente' (72 h, spec 001 §5); mismo
  // espíritu que pending_event: no hay job de limpieza, se filtra al leer.
  readonly pendingExpiresAt?: Date;
  readonly channelUserHash?: string;
  readonly displayName?: string;
  readonly createdAt?: Date;
}
