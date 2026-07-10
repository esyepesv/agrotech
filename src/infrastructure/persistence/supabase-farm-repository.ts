import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_META_PARTOS_POR_ANO, DEFAULT_REGION } from '../../domain/farm/farm.js';
import type { Farm } from '../../domain/farm/farm.js';
import type { Operator, OperatorRole } from '../../domain/farm/operator.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { FarmRepository, OperatorWithFarm } from '../../application/ports/farm-repository.js';
import type { PersistenceError } from '../../application/ports/persistence-error.js';
import { persistenceError } from '../../application/ports/persistence-error.js';

const FARM_TABLE = 'farm';
const OPERATOR_TABLE = 'operator';

interface FarmRow {
  readonly id: string;
  readonly name: string;
  readonly owner_name: string | null;
  readonly meta_partos_por_ano: number | null;
  readonly region: string | null;
  readonly created_at: string;
}

interface OperatorRow {
  readonly id: string;
  readonly farm_id: string;
  readonly channel_user_hash: string;
  readonly display_name: string | null;
  readonly role: string;
}

/**
 * Persiste Farm/Operator en Supabase y resuelve identidad por el hash del
 * canal (D2 de PLAN-v1.1.md). Solo traduce snake_case ↔ camelCase; la
 * decisión de negocio (registrar, ofrecer alta) vive en los casos de uso.
 */
export class SupabaseFarmRepository implements FarmRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findOperatorByHash(channelUserHash: string): Promise<OperatorWithFarm | null> {
    // Desajuste conocido de genéricos por defecto en @supabase/supabase-js
    // (tipo SupabaseClient "pelado", Database = any): no es un any real de
    // nuestro código (mismo patrón que pgvector-retriever.ts).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: operatorData, error: operatorError } = await this.client
      .from(OPERATOR_TABLE)
      .select('*')
      .eq('channel_user_hash', channelUserHash)
      .maybeSingle();

    if (operatorError !== null || operatorData === null) {
      return null;
    }
    const operator = toOperator(operatorData as OperatorRow);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: farmData, error: farmError } = await this.client
      .from(FARM_TABLE)
      .select('*')
      .eq('id', operator.farmId)
      .maybeSingle();

    if (farmError !== null || farmData === null) {
      return null;
    }

    return { operator, farm: toFarm(farmData as FarmRow) };
  }

  async saveFarm(farm: Farm): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client.from(FARM_TABLE).upsert(fromFarm(farm));
    if (error !== null) {
      return err(persistenceError(`fallo al guardar granja: ${error.message}`));
    }
    return ok(undefined);
  }

  async saveOperator(operator: Operator): Promise<Result<void, PersistenceError>> {
    const { error } = await this.client.from(OPERATOR_TABLE).upsert(fromOperator(operator));
    if (error !== null) {
      return err(persistenceError(`fallo al guardar operario: ${error.message}`));
    }
    return ok(undefined);
  }
}

function toFarm(row: FarmRow): Farm {
  return {
    id: row.id,
    name: row.name,
    ownerName: row.owner_name ?? undefined,
    config: {
      metaPartosPorAno: row.meta_partos_por_ano ?? DEFAULT_META_PARTOS_POR_ANO,
      region: row.region ?? DEFAULT_REGION,
    },
    createdAt: new Date(row.created_at),
  };
}

function fromFarm(farm: Farm): FarmRow {
  return {
    id: farm.id,
    name: farm.name,
    owner_name: farm.ownerName ?? null,
    meta_partos_por_ano: farm.config.metaPartosPorAno,
    region: farm.config.region,
    created_at: farm.createdAt.toISOString(),
  };
}

function toOperator(row: OperatorRow): Operator {
  return {
    id: row.id,
    farmId: row.farm_id,
    channelUserHash: row.channel_user_hash,
    displayName: row.display_name ?? undefined,
    role: toOperatorRole(row.role),
  };
}

function fromOperator(operator: Operator): OperatorRow {
  return {
    id: operator.id,
    farm_id: operator.farmId,
    channel_user_hash: operator.channelUserHash,
    display_name: operator.displayName ?? null,
    role: operator.role,
  };
}

// La columna `role` es `text` en Supabase (sin check constraint, D-libre):
// si llega un valor fuera de la unión (dato legado/corrupto) se degrada a
// 'operario' (el rol de menor privilegio) en vez de lanzar.
function toOperatorRole(role: string): OperatorRole {
  return role === 'admin' ? 'admin' : 'operario';
}
