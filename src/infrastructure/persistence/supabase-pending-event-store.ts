import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { OperatorId } from '../../domain/farm/operator.js';
import type { PendingDraft } from '../../domain/farm/pending-draft.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { Clock } from '../../application/ports/clock.js';
import type { PendingEventStore } from '../../application/ports/pending-event-store.js';
import type { PersistenceError } from '../../application/ports/persistence-error.js';
import { persistenceError } from '../../application/ports/persistence-error.js';

const TABLE = 'pending_event';

interface PendingEventRow {
  readonly operator_hash: string;
  readonly draft: unknown;
  readonly expires_at: string;
}

// Schema MÍNIMO (no replica el detalle de cada uno de los 11 payloads de
// FarmEventPayload: eso vive en el extractor, que es quien produce el draft
// antes de guardarlo aquí). Solo valida la forma estructural de PendingDraft
// para detectar dato corrupto en la columna jsonb (p. ej. escrito a mano,
// o por una versión vieja del esquema) sin tumbar el flujo.
const farmEventDraftSchema = z.object({
  payload: z.object({ type: z.string().min(1) }).passthrough(),
  confidence: z.number().min(0).max(1),
  camposFaltantes: z.array(z.string()),
  rawTranscript: z.string(),
  source: z.enum(['voice', 'text']),
});

const entityStubSchema = z.discriminatedUnion('entity', [
  z.object({
    entity: z.literal('farm'),
    name: z.string().min(1),
    ownerName: z.string().optional(),
  }),
  z.object({ entity: z.literal('sow'), chapeta: z.string().min(1) }),
  z.object({
    entity: z.literal('lot'),
    stage: z.enum(['precebo', 'ceba']),
    animalCount: z.number().int().nonnegative(),
  }),
]);

const pendingDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('farm_event'), draft: farmEventDraftSchema }),
  z.object({ kind: z.literal('register_entity'), entity: entityStubSchema }),
]);

/**
 * Estado conversacional corto (TTL) en Supabase (PLAN-v1.1.md §7). La clave
 * de fila es el hash del canal-usuario (mismo valor que `operator.channel_
 * user_hash`, o el hash crudo si aún no hay Operator — ver comentario en la
 * migración): el puerto lo llama `operatorId`, pero es el mismo string.
 */
export class SupabasePendingEventStore implements PendingEventStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly clock: Clock,
  ) {}

  async savePending(
    operatorId: OperatorId,
    pending: PendingDraft,
    ttlSeconds: number,
  ): Promise<Result<void, PersistenceError>> {
    const now = this.clock.now();

    // Borrado perezoso de vencidos para este mismo hash (barato y suficiente,
    // PLAN-v1.1.md §7: sin cron). Se ignora el resultado: si falla, el
    // upsert de abajo igual sobreescribe la fila vigente por PK.
    await this.client
      .from(TABLE)
      .delete()
      .eq('operator_hash', operatorId)
      .lt('expires_at', now.toISOString());

    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const { error } = await this.client.from(TABLE).upsert(
      {
        operator_hash: operatorId,
        draft: pending,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'operator_hash' },
    );

    if (error !== null) {
      return err(persistenceError(`fallo al guardar pendiente: ${error.message}`));
    }
    return ok(undefined);
  }

  async takePending(operatorId: OperatorId): Promise<PendingDraft | null> {
    const now = this.clock.now().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- desajuste conocido de genéricos de supabase-js (ver pgvector-retriever.ts)
    const { data, error } = await this.client
      .from(TABLE)
      .delete()
      .eq('operator_hash', operatorId)
      .gt('expires_at', now)
      .select()
      .maybeSingle();

    if (error !== null || data === null) {
      return null;
    }
    // La fila ya fue borrada por el delete de arriba (lee-y-borra atómico);
    // si el jsonb no parsea, ya no hay nada extra que limpiar (dato corrupto
    // no debe tumbar el flujo: se trata como "no hay pendiente").
    return parseDraft((data as PendingEventRow).draft);
  }

  async hasPending(operatorId: OperatorId): Promise<boolean> {
    const now = this.clock.now().toISOString();
    const { count, error } = await this.client
      .from(TABLE)
      .select('operator_hash', { count: 'exact', head: true })
      .eq('operator_hash', operatorId)
      .gt('expires_at', now);

    if (error !== null || count === null) {
      return false;
    }
    return count > 0;
  }
}

function parseDraft(raw: unknown): PendingDraft | null {
  const parsed = pendingDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  // El zod schema es intencionalmente más laxo que la unión discriminada de
  // dominio (payload con `.passthrough()`, sin repetir los 11 payloads):
  // ya validamos la forma mínima requerida por PendingDraft, así que el
  // cast es seguro en la práctica aunque no sea estructuralmente idéntico
  // para el compilador.
  return parsed.data as unknown as PendingDraft;
}
