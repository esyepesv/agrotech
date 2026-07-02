export interface ChunkMetadata {
  readonly topic: string;
  readonly validatedBy: string;
  /** ISO-8601, ej. 2026-01-15T00:00:00Z */
  readonly updatedAt: string;
  readonly region: string;
}

export interface RetrievedChunk {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly score: number;
  readonly metadata: ChunkMetadata;
}

export interface KnowledgeReference {
  readonly id: string;
  readonly source: string;
}

export function toReference(chunk: RetrievedChunk): KnowledgeReference {
  return { id: chunk.id, source: chunk.source };
}
