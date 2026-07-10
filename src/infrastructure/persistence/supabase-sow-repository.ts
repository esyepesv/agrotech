import type { SupabaseClient } from '@supabase/supabase-js';
import type { Sow, SowStatus } from '../../domain/farm/sow.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { SowRepository } from '../../application/ports/sow-repository.js';
import type { PersistenceError } from '../../application/ports/persistence-error.js';
import { persistenceError } from '../../application/ports/persistence-error.js';

const TABLE = 'sow';

interface SowRow {
  readonly id: string;
  readonly farm_id: string;
  readonly chapeta: string;
  readonly entry_date: string | null;
  readonly initial_weight_kg: number | null;
  readonly initial_cost: number | null;
  readonly genetic_line: string | null;
  readonly num_pezones: number | null;
  readonly aplomos: string | null;
  readonly status: string;
  readonly current_pen_id: string | null;
}

const SOW_STATUSES: readonly SowStatus[] = [
  'reemplazo',
  'gestante',
  'lactante',
  'vacia',
  'descarte',
];

/**
 * Persiste Sow (cría individual) en Supabase. En Corte 1 solo lo consume el
 * stub de onboarding progresivo (ConfirmFarmEvent); el ciclo reproductivo
 * completo llega en Corte 3. Solo traduce snake_case ↔ camelCase.
 */
export class SupabaseSowRepository implements SowRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByChapeta(farmId: string, chapeta: string): Promise<Sow | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('farm_id', farmId)
      .eq('chapeta', chapeta)
      .maybeSingle();

    if (error !== null || data === null) {
      return null;
    }
    return toSow(data as SowRow);
  }

  async save(sow: Sow): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client.from(TABLE).upsert(fromSow(sow));
    if (error !== null) {
      return err(persistenceError(`fallo al guardar cerda: ${error.message}`));
    }
    return ok(undefined);
  }

  async list(farmId: string, status?: SowStatus): Promise<Sow[]> {
    let query = this.client.from(TABLE).select('*').eq('farm_id', farmId);
    if (status !== undefined) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error !== null || data === null) {
      return [];
    }
    return (data as SowRow[]).map(toSow);
  }
}

function toSow(row: SowRow): Sow {
  return {
    id: row.id,
    farmId: row.farm_id,
    chapeta: row.chapeta,
    entryDate: row.entry_date === null ? undefined : new Date(row.entry_date),
    initialWeightKg: row.initial_weight_kg ?? undefined,
    initialCost: row.initial_cost ?? undefined,
    geneticLine: row.genetic_line ?? undefined,
    numPezones: row.num_pezones ?? undefined,
    aplomos: row.aplomos ?? undefined,
    status: toSowStatus(row.status),
    currentPenId: row.current_pen_id ?? undefined,
  };
}

function fromSow(sow: Sow): SowRow {
  return {
    id: sow.id,
    farm_id: sow.farmId,
    chapeta: sow.chapeta,
    entry_date: sow.entryDate === undefined ? null : sow.entryDate.toISOString().slice(0, 10),
    initial_weight_kg: sow.initialWeightKg ?? null,
    initial_cost: sow.initialCost ?? null,
    genetic_line: sow.geneticLine ?? null,
    num_pezones: sow.numPezones ?? null,
    aplomos: sow.aplomos ?? null,
    status: sow.status,
    current_pen_id: sow.currentPenId ?? null,
  };
}

// `status` es text en la BD: un valor fuera de la unión (dato corrupto) se
// degrada a 'reemplazo' (estado inicial) en vez de lanzar.
function toSowStatus(status: string): SowStatus {
  return (SOW_STATUSES as readonly string[]).includes(status) ? (status as SowStatus) : 'reemplazo';
}
