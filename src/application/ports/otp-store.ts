import type { Result } from '../../domain/shared/result.js';
import type { OtpDestinationKind } from '../../domain/otp/otp-destination.js';
import type { PersistenceError } from './persistence-error.js';

export type OtpTransport = 'whatsapp' | 'telegram' | 'sms' | 'email';

/**
 * Destino ya normalizado (`normalizeDestination`): E.164 o correo en
 * minúsculas. Es la llave real del OTP, no el canal de entrega — un mismo
 * celular verificado por SMS o por WhatsApp es la misma prueba de posesión.
 */
export interface OtpKey {
  readonly destination: string;
}

export type OtpVerifyStatus =
  'verified' | 'invalid_code' | 'expired' | 'not_found' | 'too_many_attempts';

export interface SaveOtpCodeParams {
  readonly destinationKind: OtpDestinationKind;
  /** Medio por el que se envió esta vez (informativo, no forma parte de la llave). */
  readonly transport: OtpTransport;
  readonly codeHash: string;
  readonly ttlSeconds: number;
  readonly maxAttempts: number;
}

export interface OtpVerification {
  readonly destination: string;
  readonly destinationKind: OtpDestinationKind;
  readonly verifiedAt: Date;
}

/**
 * Almacén de OTP (arquitectura-v1.2.md §6/§8, extendido para multi-
 * transporte). El código en claro nunca atraviesa `saveCode` (recibe el
 * hash ya calculado por `hashOtpCode`); `verifyCode` recibe el código plano
 * porque necesita volver a hashearlo con el mismo pepper para compararlo.
 */
export interface OtpStore {
  saveCode(key: OtpKey, params: SaveOtpCodeParams): Promise<Result<void, PersistenceError>>;
  verifyCode(key: OtpKey, code: string): Promise<OtpVerifyStatus>;
  /** true solo si hay un `verified_at` dentro de la ventana de gracia. */
  isVerified(key: OtpKey, graceSeconds: number): Promise<boolean>;
  /**
   * Detalle de la verificación vigente (o `null`). `destinationKind`
   * importa para no derivar identidad de canal (p. ej. WhatsApp) de un
   * correo verificado: un correo no prueba posesión de un número.
   */
  getVerification(key: OtpKey): Promise<OtpVerification | null>;
  consume(key: OtpKey): Promise<void>;
}
