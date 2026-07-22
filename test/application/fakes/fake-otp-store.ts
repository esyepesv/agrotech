import type { Clock } from '../../../src/application/ports/clock.js';
import type {
  OtpKey,
  OtpStore,
  OtpVerification,
  OtpVerifyStatus,
  SaveOtpCodeParams,
} from '../../../src/application/ports/otp-store.js';
import type { PersistenceError } from '../../../src/application/ports/persistence-error.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';

interface OtpEntry {
  params: SaveOtpCodeParams;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
}

/**
 * Fake in-memory de `OtpStore`. NO reimplementa el hasheo real: guarda
 * `codeHash` tal cual y `verifyCode` lo compara directo contra `code` — el
 * llamador debe pasar el mismo valor en ambos lados. El hasheo real vive en
 * `SupabaseOtpStore` + `otp-code.ts` (ver `otp-code.spec.ts`).
 */
export class FakeOtpStore implements OtpStore {
  readonly entries = new Map<string, OtpEntry>();

  constructor(private readonly clock: Clock) {}

  async saveCode(key: OtpKey, params: SaveOtpCodeParams): Promise<Result<void, PersistenceError>> {
    const expiresAt = new Date(this.clock.now().getTime() + params.ttlSeconds * 1000);
    this.entries.set(key.destination, { params, attempts: 0, expiresAt, verifiedAt: null });
    return ok(undefined);
  }

  async verifyCode(key: OtpKey, code: string): Promise<OtpVerifyStatus> {
    const entry = this.entries.get(key.destination);
    if (!entry) {
      return 'not_found';
    }
    const now = this.clock.now().getTime();
    if (entry.expiresAt.getTime() <= now) {
      return 'expired';
    }
    if (entry.attempts >= entry.params.maxAttempts) {
      return 'too_many_attempts';
    }
    if (entry.params.codeHash !== code) {
      entry.attempts += 1;
      return 'invalid_code';
    }
    entry.verifiedAt = this.clock.now();
    return 'verified';
  }

  async isVerified(key: OtpKey, graceSeconds: number): Promise<boolean> {
    const entry = this.entries.get(key.destination);
    if (!entry || entry.verifiedAt === null) {
      return false;
    }
    return this.clock.now().getTime() - entry.verifiedAt.getTime() <= graceSeconds * 1000;
  }

  async getVerification(key: OtpKey): Promise<OtpVerification | null> {
    const entry = this.entries.get(key.destination);
    if (!entry || entry.verifiedAt === null) {
      return null;
    }
    return {
      destination: key.destination,
      destinationKind: entry.params.destinationKind,
      verifiedAt: entry.verifiedAt,
    };
  }

  async consume(key: OtpKey): Promise<void> {
    this.entries.delete(key.destination);
  }
}
