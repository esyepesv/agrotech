import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { LlmAnswerGenerator } from '../../src/infrastructure/llm/llm-answer-generator.js';
import type { RetrievedChunk } from '../../src/domain/knowledge/retrieved-chunk.js';

/**
 * Test de integración real contra OpenRouter. Se salta si no hay
 * LLM_API_KEY en el entorno (sección 16).
 */
describe.skipIf(!process.env.LLM_API_KEY)('LlmAnswerGenerator (integración real)', () => {
  it('genera una respuesta grounded en el contexto entregado', async () => {
    const client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
    });
    const generator = new LlmAnswerGenerator(
      client,
      process.env.LLM_MODEL ?? 'anthropic/claude-sonnet-4.5',
    );

    const context: RetrievedChunk[] = [
      {
        id: 'chunk-1',
        content:
          'Durante la lactancia se debe alimentar a la hembra a voluntad, en 2 a 3 comidas diarias.',
        source: 'alimentacion-hembra-lactante.md',
        score: 0.9,
        metadata: {
          topic: 'alimentacion',
          validatedBy: 'PENDIENTE zootecnista',
          updatedAt: new Date().toISOString(),
          region: 'CO',
        },
      },
    ];

    const result = await generator.generate({
      question: '¿cómo debo alimentar a una hembra lactante?',
      context,
      locale: 'es-CO',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text.length).toBeGreaterThan(0);
      expect(result.value.usedSources).toEqual([
        { id: 'chunk-1', source: 'alimentacion-hembra-lactante.md' },
      ]);
    }
  });
});
