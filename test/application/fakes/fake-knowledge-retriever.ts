import type { RetrievedChunk } from '../../../src/domain/knowledge/retrieved-chunk.js';
import type { KnowledgeRetriever } from '../../../src/application/ports/knowledge-retriever.js';

export function sampleChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    content: 'La hembra lactante debe alimentarse a voluntad, con 2 a 3 comidas al día.',
    source: 'alimentacion.md',
    score: 0.92,
    metadata: {
      topic: 'alimentacion',
      validatedBy: 'zootecnista-demo',
      updatedAt: '2026-01-15T00:00:00Z',
      region: 'CO',
    },
    ...overrides,
  };
}

export class FakeKnowledgeRetriever implements KnowledgeRetriever {
  readonly queries: { query: string; k: number }[] = [];

  constructor(private readonly chunks: RetrievedChunk[] = [sampleChunk()]) {}

  async retrieve(query: string, k: number): Promise<RetrievedChunk[]> {
    this.queries.push({ query, k });
    return this.chunks.slice(0, k);
  }
}
