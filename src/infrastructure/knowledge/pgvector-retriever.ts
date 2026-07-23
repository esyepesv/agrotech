import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkMetadata, RetrievedChunk } from '../../domain/knowledge/retrieved-chunk.js';
import type { KnowledgeRetriever } from '../../application/ports/knowledge-retriever.js';
import type { Embedder } from '../../application/ports/embedder.js';

interface MatchRow {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly topic: string | null;
  readonly validated_by: string | null;
  readonly region: string | null;
  readonly updated_at: string;
  readonly similarity: number;
}

const MATCH_FUNCTION = 'match_knowledge_chunks';

/**
 * Recupera fragmentos del corpus curado desde Supabase/pgvector mediante
 * una función RPC de similitud coseno. Reutiliza el puerto Embedder para
 * vectorizar la consulta con la misma configuración que la ingestión.
 */
export class PgVectorRetriever implements KnowledgeRetriever {
  constructor(
    private readonly client: SupabaseClient,
    private readonly embedder: Embedder,
  ) {}

  async retrieve(query: string, k: number): Promise<RetrievedChunk[]> {
    const embedding = await this.embedder.embed(query);

    // Desajuste conocido de genéricos por defecto en @supabase/supabase-js
    // (tipo SupabaseClient "pelado"): no es un any real de nuestro código.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.client.rpc(MATCH_FUNCTION, {
      query_embedding: embedding,
      match_count: k,
    });

    if (error !== null) {
      throw new Error(`fallo en recuperación pgvector: ${error.message}`);
    }

    const rows = (data ?? []) as MatchRow[];
    return rows.map(toChunk);
  }
}

function toChunk(row: MatchRow): RetrievedChunk {
  const metadata: ChunkMetadata = {
    topic: row.topic ?? 'general',
    validatedBy: row.validated_by ?? 'desconocido',
    updatedAt: row.updated_at,
    region: row.region ?? 'CO',
  };
  return {
    id: row.id,
    content: row.content,
    source: row.source,
    score: row.similarity,
    metadata,
  };
}
