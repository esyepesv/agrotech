import type { SupabaseClient } from '@supabase/supabase-js';
import type { Clock } from '../../application/ports/clock.js';
import type {
  OtpKey,
  OtpStore,
  OtpVerification,
  OtpVerifyStatus,
  SaveOtpCodeParams,
} from '../../application/ports/otp-store.js';
import type { PersistenceError } from '../../application/ports/persistence-error.js';
import { persistenceError } from '../../application/ports/persistence-error.js';
import type { OtpDestinationKind } from '../../domain/otp/otp-destination.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import { hashOtpCode } from '../security/otp-code.js';

const TABLE = 'otp_code';

interface OtpRow {
  readonly destination: string;
  readonly destination_kind: string;
  readonly last_transport: string;
  readonly code_hash: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly expires_at: string;
  readonly verified_at: string | null;
}

/**
 * Almacén de OTP en Supabase, PK = `destination` (celular E.164 o correo ya
 * normalizados por `normalizeDestination`). El código en claro nunca llega
 * aquí: `saveCode` recibe el hash ya calculado; `verifyCode` recibe el
 * código plano solo para volver a hashearlo con el mismo pepper y
 * compararlo (nunca se persiste ni se loguea en claro).
 */
export class SupabaseOtpStore implements OtpStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly clock: Clock,
    private readonly pepper: string,
  ) {}

  async saveCode(key: OtpKey, params: SaveOtpCodeParams): Promise<Result<void, PersistenceError>> {
    const now = this.clock.now();

    // Limpieza perezosa de este mismo destino si quedó vencido (mismo
    // patrón que SupabasePendingEventStore): barata y suficiente, sin cron.
    await this.client
      .from(TABLE)
      .delete()
      .eq('destination', key.destination)
      .lt('expires_at', now.toISOString());

    const expiresAt = new Date(now.getTime() + params.ttlSeconds * 1000);
    const { error } = await this.client.from(TABLE).upsert(
      {
        destination: key.destination,
        destination_kind: params.destinationKind,
        last_transport: params.transport,
        code_hash: params.codeHash,
        attempts: 0,
        max_attempts: params.maxAttempts,
        expires_at: expiresAt.toISOString(),
        verified_at: null,
      },
      { onConflict: 'destination' },
    );

    if (error !== null) {
      return err(persistenceError(`fallo al guardar OTP: ${error.message}`));
    }
    return ok(undefined);
  }

  async verifyCode(key: OtpKey, code: string): Promise<OtpVerifyStatus> {
    const row = await this.fetchRow(key);
    if (row === null) {
      return 'not_found';
    }

    const now = this.clock.now();
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      return 'expired';
    }
    if (row.attempts >= row.max_attempts) {
      return 'too_many_attempts';
    }

    const candidateHash = hashOtpCode(code, this.pepper);
    if (candidateHash !== row.code_hash) {
      await this.client
        .from(TABLE)
        .update({ attempts: row.attempts + 1 })
        .eq('destination', key.destination);
      return 'invalid_code';
    }

    await this.client
      .from(TABLE)
      .update({ verified_at: now.toISOString() })
      .eq('destination', key.destination);
    return 'verified';
  }

  async isVerified(key: OtpKey, graceSeconds: number): Promise<boolean> {
    const verification = await this.getVerification(key);
    if (verification === null) {
      return false;
    }
    return this.clock.now().getTime() - verification.verifiedAt.getTime() <= graceSeconds * 1000;
  }

  async getVerification(key: OtpKey): Promise<OtpVerification | null> {
    const row = await this.fetchRow(key);
    if (row === null || row.verified_at === null) {
      return null;
    }
    const destinationKind: OtpDestinationKind =
      row.destination_kind === 'email' ? 'email' : 'phone';
    return {
      destination: row.destination,
      destinationKind,
      verifiedAt: new Date(row.verified_at),
    };
  }

  async consume(key: OtpKey): Promise<void> {
    await this.client.from(TABLE).delete().eq('destination', key.destination);
  }

  private async fetchRow(key: OtpKey): Promise<OtpRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- desajuste conocido de genéricos de supabase-js (ver pgvector-retriever.ts)
    const { data, error } = await this.client
      .from(TABLE)
      .select()
      .eq('destination', key.destination)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    return data as OtpRow;
  }
}
