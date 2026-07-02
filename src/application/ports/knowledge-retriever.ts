import type { RetrievedChunk } from '../../domain/knowledge/retrieved-chunk.js';

export interface KnowledgeRetriever {
  retrieve(query: string, k: number): Promise<RetrievedChunk[]>;
}
