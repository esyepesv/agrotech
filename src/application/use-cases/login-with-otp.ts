import { IDENTIFICATION_TYPES, type AppUser } from '../../domain/farm/app-user.js';
import { normalizeDestination } from '../../domain/otp/otp-destination.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { FarmRepository, OperatorWithFarm } from '../ports/farm-repository.js';
import type { OtpStore } from '../ports/otp-store.js';
import type { SessionIssuer } from '../ports/session-issuer.js';

export interface LoginDestination {
  readonly kind: 'phone' | 'email';
  readonly masked: string;
}

export interface LoginFarm {
  readonly farmId: string;
  readonly farmName: string;
  readonly role: string;
}

export interface LoginWithOtpDeps {
  readonly farmRepository: FarmRepository;
  readonly otpStore: OtpStore;
  readonly sessionIssuer: SessionIssuer;
  readonly sessionTtlSeconds: number;
}

export interface LoginWithOtpError {
  readonly kind: 'invalid_credentials';
  readonly message: string;
}

export interface LoginDestinationsInput {
  readonly identifier: string;
}

export interface LoginVerifyInput {
  readonly identifier: string;
  readonly code: string;
}

const GENERIC_DESTINATIONS: readonly LoginDestination[] = [
  { kind: 'email', masked: 'c••••@correo.com' },
];

const INVALID_CREDENTIALS: LoginWithOtpError = {
  kind: 'invalid_credentials',
  message: 'No pudimos validar esos datos. Revisa el código e intenta de nuevo.',
};

/**
 * Inicia y termina el login desde otro dispositivo sin volver la cédula o
 * el correo un oráculo de cuentas existentes. El modelo actual conserva el
 * correo (obligatorio), pero solo hashes del celular; por eso el único
 * destino recuperable para este flujo es el correo. El celular sigue
 * verificable cuando la persona lo aporta explícitamente en `/account/*`.
 */
export class LoginWithOtp {
  constructor(private readonly deps: LoginWithOtpDeps) {}

  async destinations(
    input: LoginDestinationsInput,
  ): Promise<Result<{ destinations: readonly LoginDestination[] }, never>> {
    const user = await this.findUser(input.identifier);
    // Para una cuenta inexistente se devuelve una opción plausible. Así ni
    // el status ni la forma de la respuesta revelan si el identificador está
    // registrado; tampoco se expone correo alguno de una persona real.
    return ok({
      destinations:
        user === null ? GENERIC_DESTINATIONS : [{ kind: 'email', masked: maskEmail(user.email) }],
    });
  }

  async verify(
    input: LoginVerifyInput,
  ): Promise<
    Result<
      { session: { token: string; expiresInSeconds: number }; farms: readonly LoginFarm[] },
      LoginWithOtpError
    >
  > {
    const user = await this.findUser(input.identifier);
    if (user === null) {
      return err(INVALID_CREDENTIALS);
    }

    const status = await this.deps.otpStore.verifyCode({ destination: user.email }, input.code);
    if (status !== 'verified') {
      return err(INVALID_CREDENTIALS);
    }

    const memberships = await this.deps.farmRepository.findFarmsByUser(user.id);
    // Se prefiere una membresía activa, pero una 'pendiente' también deja
    // entrar: un trabajador cuya solicitud aún no aprueban SÍ tiene cuenta, y
    // antes recibía "No pudimos validar esos datos" —el mismo mensaje que un
    // código equivocado—, así que parecía un login roto y no una espera.
    // Los permisos siguen colgando de operator.status, no de tener sesión.
    const membership = memberships.find((m) => m.operator.status === 'activo') ?? memberships[0];
    if (membership === undefined) {
      return err(INVALID_CREDENTIALS);
    }

    const farms = memberships.map(toLoginFarm);
    const token = this.deps.sessionIssuer.issue(
      {
        userId: user.id,
        operatorId: membership.operator.id,
        farmId: membership.farm.id,
        role: membership.operator.role,
      },
      this.deps.sessionTtlSeconds,
    );
    return ok({
      session: { token, expiresInSeconds: this.deps.sessionTtlSeconds },
      farms,
    });
  }

  async emailDestination(identifier: string): Promise<string | null> {
    const user = await this.findUser(identifier);
    return user?.email ?? null;
  }

  private async findUser(identifier: string): Promise<AppUser | null> {
    const normalized = identifier.trim();
    if (normalized.includes('@')) {
      return this.deps.farmRepository.findUserByEmail(normalizeDestination(normalized, 'email'));
    }

    for (const identificationType of IDENTIFICATION_TYPES) {
      const user = await this.deps.farmRepository.findUserByIdentification(
        identificationType,
        normalized,
      );
      if (user !== null) {
        return user;
      }
    }
    return null;
  }
}

function maskEmail(email: string): string {
  const [local = '', domain = 'correo.com'] = email.split('@');
  const first = local.slice(0, 1) || 'c';
  return `${first}••••@${domain}`;
}

function toLoginFarm(membership: OperatorWithFarm): LoginFarm {
  return {
    farmId: membership.farm.id,
    farmName: membership.farm.name,
    role: membership.operator.role,
  };
}
