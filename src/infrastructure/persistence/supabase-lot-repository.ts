import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lot, LotStage, LotStatus } from '../../domain/farm/lot.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { LotRepository } from '../../application/ports/lot-repository.js';
import type { PersistenceError } from '../../application/ports/persistence-error.js';
import { persistenceError } from '../../application/ports/persistence-error.js';

const TABLE = 'lot';

interface LotRow {
  readonly id: string;
  readonly farm_id: string;
  readonly stage: string;
  readonly start_date: string | null;
  readonly animal_count: number | null;
  readonly pen_id: string | null;
  readonly avg_initial_weight_kg: number | null;
  readonly avg_final_weight_kg: number | null;
  readonly status: string;
}

/**
 * Persiste Lot (pre-cebo/ceba) en Supabase. En Corte 1 solo lo consume el
 * stub de onboarding progresivo (ConfirmFarmEvent); el ciclo de lote
 * completo llega en Corte 2. Solo traduce snake_case ↔ camelCase.
 */
export class SupabaseLotRepository implements LotRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findById(farmId: string, lotId: string): Promise<Lot | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('farm_id', farmId)
      .eq('id', lotId)
      .maybeSingle();

    if (error !== null || data === null) {
      return null;
    }
    return toLot(data as LotRow);
  }

  async save(lot: Lot): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client.from(TABLE).upsert(fromLot(lot));
    if (error !== null) {
      return err(persistenceError(`fallo al guardar lote: ${error.message}`));
    }
    return ok(undefined);
  }

  async list(farmId: string, status?: LotStatus): Promise<Lot[]> {
    let query = this.client.from(TABLE).select('*').eq('farm_id', farmId);
    if (status !== undefined) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error !== null || data === null) {
      return [];
    }
    return (data as LotRow[]).map(toLot);
  }
}

// `stage`/`status` son text en la BD (con check): un valor inesperado se
// degrada al valor más conservador en vez de lanzar.
function toLot(row: LotRow): Lot {
  const stage: LotStage = row.stage === 'precebo' ? 'precebo' : 'ceba';
  const status: LotStatus = row.status === 'cerrado' ? 'cerrado' : 'activo';
  return {
    id: row.id,
    farmId: row.farm_id,
    stage,
    startDate: row.start_date === null ? undefined : new Date(row.start_date),
    animalCount: row.animal_count ?? 0,
    penId: row.pen_id ?? undefined,
    avgInitialWeightKg: row.avg_initial_weight_kg ?? undefined,
    avgFinalWeightKg: row.avg_final_weight_kg ?? undefined,
    status,
  };
}

function fromLot(lot: Lot): LotRow {
  return {
    id: lot.id,
    farm_id: lot.farmId,
    stage: lot.stage,
    start_date: lot.startDate === undefined ? null : lot.startDate.toISOString().slice(0, 10),
    animal_count: lot.animalCount,
    pen_id: lot.penId ?? null,
    avg_initial_weight_kg: lot.avgInitialWeightKg ?? null,
    avg_final_weight_kg: lot.avgFinalWeightKg ?? null,
    status: lot.status,
  };
}
