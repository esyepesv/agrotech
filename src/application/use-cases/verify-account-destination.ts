import type { AppUser } from '../../domain/farm/app-user.js';
import type { OtpDestinationKind } from '../../domain/otp/otp-destination.js';
import { normalizeDestination } from '../../domain/otp/otp-destination.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { Clock } from '../ports/clock.js';
import type { FarmRepository } from '../ports/farm-repository.js';
import type { OtpStore, OtpVerifyStatus } from '../ports/otp-store.js';

export interface VerifyAccountDestinationDeps {
  readonly farmRepository: FarmRepository;
  readonly otpStore: OtpStore;
  readonly hashUserId: (raw: string) => string;
  readonly clock: Clock;
}

export interface VerifyAccountDestinationInput {
  readonly userId: string;
  readonly destination: string;
  readonly code: string;
}

export interface VerifyAccountDestinationOutcome {
  readonly destinationKind: OtpDestinationKind;
}

export interface VerifyAccountDestinationError {
  readonly kind:
    'destination_mismatch' | 'invalid_code' | 'expired' | 'too_many_attempts' | 'persistence';
  readonly message: string;
}

/**
 * Verifica el celular o el correo de una cuenta YA registrada, con sesión
 * (hashed-zooming-flame.md, Tarea 5). Es una acción opcional posterior al
 * registro (Tarea 4 sacó el OTP del registro): esta es la única forma en
 * que un correo queda `email_verified_at`, y una de dos formas (junto al
 * ligado automático en chat, Tarea 7) en que un celular queda ligado a la
 * identidad de chat.
 */
export class VerifyAccountDestination {
  constructor(private readonly deps: VerifyAccountDestinationDeps) {}

  async verify(
    input: VerifyAccountDestinationInput,
  ): Promise<Result<VerifyAccountDestinationOutcome, VerifyAccountDestinationError>> {
    const destinationKind: OtpDestinationKind = input.destination.includes('@') ? 'email' : 'phone';
    const normalizedDestination = normalizeDestination(input.destination, destinationKind);

    // El destino debe pertenecer a la cuenta del token ANTES de gastar un
    // intento contra el OTP: sin este chequeo, cualquiera con sesión podría
    // usar este endpoint para probar códigos ajenos o, peor, terminar
    // ligando su chat a un celular que no es el de su cuenta.
    const user = await this.deps.farmRepository.findUserById(input.userId);
    if (user === null || !this.belongsToUser(user, destinationKind, normalizedDestination)) {
      return err({
        kind: 'destination_mismatch',
        message: 'Ese celular o correo no pertenece a tu cuenta.',
      });
    }

    const status = await this.deps.otpStore.verifyCode(
      { destination: normalizedDestination },
      input.code,
    );
    const verifyError = toVerifyError(status);
    if (verifyError !== undefined) {
      return err(verifyError);
    }

    const now = this.deps.clock.now();
    // Verificar el celular liga la identidad de chat (channelUserHash =
    // phoneHash): es lo que hace que el bot reconozca después a esta
    // persona en WhatsApp. Verificar el correo NUNCA hace esto — un correo
    // no prueba posesión de un número.
    const attached = await this.deps.farmRepository.attachChatIdentity(
      user.id,
      destinationKind === 'phone'
        ? { channelUserHash: user.phoneHash, phoneVerifiedAt: now }
        : { emailVerifiedAt: now },
    );
    if (!attached.ok) {
      return err({
        kind: 'persistence',
        message: 'Tuvimos un problema guardando la verificación. Intenta de nuevo.',
      });
    }

    return ok({ destinationKind });
  }

  private belongsToUser(
    user: AppUser,
    destinationKind: OtpDestinationKind,
    normalizedDestination: string,
  ): boolean {
    if (destinationKind === 'phone') {
      return this.deps.hashUserId(normalizedDestination) === user.phoneHash;
    }
    // user.email ya queda normalizado (minúsculas, sin espacios) desde el
    // registro (validateUserInput) — misma normalización, comparación directa.
    return normalizedDestination === user.email;
  }
}

function toVerifyError(status: OtpVerifyStatus): VerifyAccountDestinationError | undefined {
  switch (status) {
    case 'verified':
      return undefined;
    case 'invalid_code':
      return {
        kind: 'invalid_code',
        message: 'Ese código no es correcto. Revisa e inténtalo de nuevo.',
      };
    case 'not_found':
      return {
        kind: 'invalid_code',
        message: 'No encontramos un código pendiente para ese destino. Solicita uno nuevo.',
      };
    case 'expired':
      return { kind: 'expired', message: 'El código venció, solicita uno nuevo.' };
    case 'too_many_attempts':
      return {
        kind: 'too_many_attempts',
        message: 'Intentaste demasiadas veces. Pide un código nuevo.',
      };
  }
}
