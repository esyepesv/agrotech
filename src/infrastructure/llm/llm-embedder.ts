import type OpenAI from 'openai';
import type { Embedder } from '../../application/ports/embedder.js';

/**
 * Embeddings con la API de OpenAI (text-embedding-3-small). Un solo lugar
 * decide cómo se embeben los textos: lo usa el retriever en runtime y el
 * script de ingestión (sección 12), garantizando consistencia.
 */
export class LlmEmbedder implements Embedder {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });

    const embedding = response.data[0]?.embedding;
    if (embedding === undefined) {
      throw new Error('respuesta de embeddings vacía');
    }
    return embedding;
  }
}
