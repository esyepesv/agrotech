import type { IdentificationType } from './app-user.js';
import type { FarmId } from './farm.js';
import { normalizeDestination } from '../otp/otp-destination.js';
import { err, ok, type Result } from '../shared/result.js';

export type Channel = 'whatsapp' | 'telegram';

export interface UserInput {
  readonly identificationType: IdentificationType;
  readonly identificationNumber: string;
  readonly phone: string;
  readonly channel: Channel;
  readonly email: string;
  readonly displayName?: string;
  // Quién probó la posesión del celular/correo, y no el texto del campo
  // (spec 001 §4.1.2/§4.3): el adaptador decide esto ANTES de llamar al
  // caso de uso — WhatsApp: channelUserId ES el celular, siempre true;
  // Telegram: true solo si vino de "Compartir mi número" (request_contact);
  // en cualquier otro caso (número tecleado, distinto al detectado) exige
  // OTP y solo es true tras verificarlo. RegisterFarmAndUser hace cumplir
  // una única regla con esto: channel_user_hash solo se escribe si
  // phoneVerified es true.
  readonly phoneVerified: boolean;
  readonly emailVerified: boolean;
}

export interface FarmInput {
  readonly name: string;
  readonly legalType: 'natural' | 'juridica';
  readonly taxIdType: 'cedula' | 'nit';
  readonly taxId: string;
  readonly location: string;
  readonly cebaCapacity: number;
  readonly breedingCapacity: number;
  readonly totalCapacity: number;
  readonly sanitaryRegistry: string;
}

export interface WorkerInvitationInput {
  readonly displayName: string;
  readonly identificationNumber: string;
  readonly phone: string;
}

export interface RegisterOwnerInput {
  readonly kind: 'owner';
  readonly user: UserInput;
  readonly farm: FarmInput;
  readonly workers?: readonly WorkerInvitationInput[];
}

export interface RegisterWorkerInput {
  readonly kind: 'worker';
  readonly user: UserInput;
  readonly farmId: FarmId;
}

export type RegisterFarmAndUserInput = RegisterOwnerInput | RegisterWorkerInput;

export type RegistrationError =
  | { readonly kind: 'duplicate_identification'; readonly message: string }
  | { readonly kind: 'duplicate_email'; readonly message: string }
  | { readonly kind: 'duplicate_farm'; readonly message: string }
  | { readonly kind: 'already_member'; readonly message: string; readonly farmName: string }
  | { readonly kind: 'farm_not_found'; readonly message: string }
  | { readonly kind: 'validation'; readonly field: string; readonly message: string }
  | { readonly kind: 'persistence'; readonly message: string };

export function validationError(field: string, message: string): RegistrationError {
  return { kind: 'validation', field, message };
}

// ── Invitación a trabajador (entidad persistida) ──────────────────────────
// No es "input" (eso es WorkerInvitationInput): es lo que queda guardado
// tras el alta del dueño, para que ApproveWorker/RegisterFarmAndUser
// resuelvan por phoneHash si un trabajador que se registra coincide con una
// invitación previa (spec 001 §4.3). Vive aquí (no en un archivo propio)
// porque es parte del mismo dominio de registro y no está en la lista de
// archivos nuevos de este corte.
export type WorkerInvitationId = string;

export interface WorkerInvitation {
  readonly id: WorkerInvitationId;
  readonly farmId: FarmId;
  readonly displayName: string;
  readonly identificationNumber: string;
  readonly phoneHash: string;
  readonly createdAt: Date;
  readonly expiresAt?: Date;
  readonly consumedAt?: Date;
}

// ── Validación y normalización puras (testeables sin mocks) ──────────────

const COLOMBIAN_MOBILE_LOCAL = /^3\d{9}$/;

/** Quita todo lo que no sea dígito y retira un prefijo de país 57 si vino incluido. */
function localDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) {
    return digits.slice(2);
  }
  return digits;
}

export function isValidColombianMobile(phone: string): boolean {
  return COLOMBIAN_MOBILE_LOCAL.test(localDigits(phone));
}

/** Normaliza un celular colombiano válido a E.164 (+57XXXXXXXXXX); null si no es válido. */
export function normalizeColombianMobileToE164(phone: string): string | null {
  const local = localDigits(phone);
  return COLOMBIAN_MOBILE_LOCAL.test(local) ? `+57${local}` : null;
}

export function isValidCapacity(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function isValidIdentificationNumber(value: string): boolean {
  return value.trim().length > 0;
}

// Deliberadamente laxo: un correo solo se comprueba de verdad enviándole
// algo, y eso lo hace la verificación por OTP (que es opcional). Esto solo
// atrapa dedazos evidentes.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value);
}

export type NormalizedUserInput = UserInput & { readonly phone: string; readonly email: string };
export type NormalizedWorkerInvitationInput = WorkerInvitationInput & { readonly phone: string };

export function validateUserInput(user: UserInput): Result<NormalizedUserInput, RegistrationError> {
  if (!isValidIdentificationNumber(user.identificationNumber)) {
    return err(validationError('identificationNumber', 'La identificación no puede estar vacía.'));
  }
  const normalizedPhone = normalizeColombianMobileToE164(user.phone);
  if (normalizedPhone === null) {
    return err(
      validationError('phone', 'El celular debe ser colombiano, de 10 dígitos y empezar por 3.'),
    );
  }
  const normalizedEmail = normalizeDestination(user.email ?? '', 'email');
  if (normalizedEmail.length === 0) {
    return err(validationError('email', 'Necesito tu correo electrónico.'));
  }
  if (!isValidEmail(normalizedEmail)) {
    return err(validationError('email', 'Ese correo no parece válido. Revísalo, por favor.'));
  }
  return ok({ ...user, phone: normalizedPhone, email: normalizedEmail });
}

export function validateFarmInput(farm: FarmInput): Result<FarmInput, RegistrationError> {
  if (farm.name.trim().length === 0) {
    return err(validationError('name', 'El nombre de la finca no puede estar vacío.'));
  }
  if (!isValidIdentificationNumber(farm.taxId)) {
    return err(validationError('taxId', 'La identificación tributaria no puede estar vacía.'));
  }
  if (farm.location.trim().length === 0) {
    return err(validationError('location', 'La ubicación no puede estar vacía.'));
  }
  if (!isValidIdentificationNumber(farm.sanitaryRegistry)) {
    return err(validationError('sanitaryRegistry', 'El registro sanitario no puede estar vacío.'));
  }
  if (!isValidCapacity(farm.cebaCapacity)) {
    return err(
      validationError('cebaCapacity', 'La capacidad de ceba debe ser un entero mayor o igual a 0.'),
    );
  }
  if (!isValidCapacity(farm.breedingCapacity)) {
    return err(
      validationError(
        'breedingCapacity',
        'La capacidad de cría debe ser un entero mayor o igual a 0.',
      ),
    );
  }
  if (!isValidCapacity(farm.totalCapacity)) {
    return err(
      validationError('totalCapacity', 'La capacidad total debe ser un entero mayor o igual a 0.'),
    );
  }
  return ok(farm);
}

export function validateWorkerInvitationInput(
  worker: WorkerInvitationInput,
  index: number,
): Result<NormalizedWorkerInvitationInput, RegistrationError> {
  if (!isValidIdentificationNumber(worker.identificationNumber)) {
    return err(
      validationError(
        `workers.${index}.identificationNumber`,
        'La identificación del trabajador no puede estar vacía.',
      ),
    );
  }
  const normalizedPhone = normalizeColombianMobileToE164(worker.phone);
  if (normalizedPhone === null) {
    return err(
      validationError(
        `workers.${index}.phone`,
        'El celular del trabajador debe ser colombiano, de 10 dígitos y empezar por 3.',
      ),
    );
  }
  return ok({ ...worker, phone: normalizedPhone });
}
