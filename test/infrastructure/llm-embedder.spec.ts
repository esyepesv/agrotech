import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { LlmEmbedder } from '../../src/infrastructure/llm/llm-embedder.js';

/**
 * Test de integración real contra la API de OpenAI. Se salta si no hay
 * OPENAI_API_KEY en el entorno (sección 16: infraestructura se prueba
 * contra el servicio real u opcionalmente se omite sin credenciales).
 */
describe.skipIf(!process.env.OPENAI_API_KEY)('LlmEmbedder (integración real)', () => {
  it('devuelve un vector de embeddings con la dimensión esperada', async () => {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const embedder = new LlmEmbedder(
      client,
      process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
    );

    const embedding = await embedder.embed('¿cómo alimento una hembra lactante?');

    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBe(1536);
    expect(embedding.every((value) => typeof value === 'number')).toBe(true);
  });
});
