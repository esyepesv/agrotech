import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from '../../shared/logger.js';
import type { MessageDeduplicator } from '../../application/ports/message-deduplicator.js';

const TABLE = 'processed_message';
const UNIQUE_VIOLATION = '23505';

/**
 * Autoridad L2 de deduplicación (compartida entre instancias serverless,
 * dedup hardening): SeenMessages (in-memory) es solo un fast-path L1 por
 * proceso, insuficiente en serverless porque cada invocación puede caer en
 * una lambda distinta. Inserta el messageId en `processed_message`; si
 * choca contra la PK (23505 = unique_violation), ya se procesó → duplicado.
 *
 * Ante cualquier OTRO error (p. ej. la migración 0002 aún no se ha aplicado
 * y la tabla no existe) se falla ABIERTO (se trata como primera vez) para
 * no dejar el bot caído antes de aplicar la migración.
 */
export class SupabaseMessageDeduplicator implements MessageDeduplicator {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async firstSight(messageId: string): Promise<boolean> {
    const { error } = await this.client.from(TABLE).insert({ message_id: messageId });

    if (error === null) {
      return true;
    }

    if (error.code === UNIQUE_VIOLATION) {
      return false;
    }

    this.logger.warn(
      { err: error, messageId },
      'fallo al deduplicar contra Supabase (¿migración 0002_processed_message pendiente de aplicar?); fail-open, se procesa el mensaje',
    );
    return true;
  }
}
