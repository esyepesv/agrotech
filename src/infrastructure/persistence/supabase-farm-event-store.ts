import type { SupabaseClient } from '@supabase/supabase-js';
import type { FarmId } from '../../domain/farm/farm.js';
import type { EventSource, FarmEvent, FarmEventPayload } from '../../domain/farm/farm-event.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { EventFilter, FarmEventStore } from '../../application/ports/farm-event-store.js';
import type { PersistenceError } from '../../application/ports/persistence-error.js';
import { persistenceError } from '../../application/ports/persistence-error.js';

const TABLE = 'farm_event';

interface FarmEventRow {
  readonly id: string;
  readonly farm_id: string;
  readonly actor_operator_id: string | null;
  readonly type: string;
  readonly payload: unknown;
  readonly occurred_at: string;
  readonly source: string;
  readonly raw_transcript: string | null;
  readonly confidence: number | null;
  readonly confirmed_at: string;
}

/**
 * Ledger append-only (fuente de verdad del módulo, PLAN-v1.1.md §5): solo
 * inserta y lee. Nunca actualiza ni borra una fila existente.
 */
export class SupabaseFarmEventStore implements FarmEventStore {
  constructor(private readonly client: SupabaseClient) {}

  async append(event: FarmEvent): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client.from(TABLE).insert(fromEvent(event));
    if (error !== null) {
      return err(persistenceError(`fallo al registrar evento en el ledger: ${error.message}`));
    }
    return ok(undefined);
  }

  async listByFarm(farmId: FarmId, filter?: EventFilter): Promise<FarmEvent[]> {
    let query = this.client.from(TABLE).select('*').eq('farm_id', farmId);
    if (filter?.types !== undefined && filter.types.length > 0) {
      query = query.in('type', filter.types);
    }
    if (filter?.from !== undefined) {
      query = query.gte('occurred_at', filter.from.toISOString());
    }
    if (filter?.to !== undefined) {
      query = query.lte('occurred_at', filter.to.toISOString());
    }
    const { data, error } = await query.order('occurred_at', { ascending: true });

    if (error !== null || data === null) {
      return [];
    }
    return (data as FarmEventRow[]).map(toEvent);
  }
}

function fromEvent(event: FarmEvent): FarmEventRow {
  return {
    id: event.id,
    farm_id: event.farmId,
    actor_operator_id: event.actorOperatorId,
    type: event.payload.type,
    payload: event.payload,
    occurred_at: event.occurredAt.toISOString(),
    source: event.source,
    raw_transcript: event.rawTranscript ?? null,
    confidence: event.confidence ?? null,
    confirmed_at: event.confirmedAt.toISOString(),
  };
}

function toEvent(row: FarmEventRow): FarmEvent {
  return {
    id: row.id,
    farmId: row.farm_id,
    // actor_operator_id es nullable en la BD (fila huérfana teórica), pero
    // el dominio lo exige no-nulo: en operación normal ConfirmFarmEvent
    // siempre lo llena (requiere un Operator confirmado antes de construir
    // el FarmEvent). El fallback a '' es solo defensivo ante dato corrupto.
    actorOperatorId: row.actor_operator_id ?? '',
    payload: row.payload as FarmEventPayload,
    occurredAt: new Date(row.occurred_at),
    source: row.source as EventSource,
    rawTranscript: row.raw_transcript ?? undefined,
    confidence: row.confidence ?? undefined,
    confirmedAt: new Date(row.confirmed_at),
  };
}
