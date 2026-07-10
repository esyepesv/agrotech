import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { LlmEventExtractor } from '../../src/infrastructure/extraction/llm-event-extractor.js';
import { ANONYMOUS_FARM_CONTEXT } from '../../src/domain/farm/farm-context.js';

/**
 * Test de integración real contra OpenRouter. Se salta si no hay
 * LLM_API_KEY en el entorno (mismo patrón que llm-answer-generator.spec.ts).
 */
// La construcción del cliente/extractor vive DENTRO de cada `it()` (no en el
// cuerpo del describe): ver el comentario equivalente en
// llm-intent-classifier.spec.ts para el porqué.
describe.skipIf(!process.env.LLM_API_KEY)('LlmEventExtractor (integración real)', () => {
  function buildExtractor(): LlmEventExtractor {
    const client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
    });
    return new LlmEventExtractor(
      client,
      process.env.EXTRACTOR_MODEL ?? 'anthropic/claude-sonnet-4.5',
    );
  }

  it('extrae feed_delivery del ejemplo canónico con qty 3 y unit bulto', async () => {
    const text = 'hoy le di 3 bultos de solla a la ceba';
    const result = await buildExtractor().extract(text, ANONYMOUS_FARM_CONTEXT, 'text');

    expect(result.ok).toBe(true);
    if (result.ok && result.value.payload.type === 'feed_delivery') {
      expect(result.value.payload.qty).toBe(3);
      expect(result.value.payload.unit).toBe('bulto');
      expect(result.value.rawTranscript).toBe(text);
      expect(result.value.source).toBe('text');
    }
  });

  it('extrae inventory_purchase con unitCost', async () => {
    const text = 'compré 10 bultos de italcol a 95 mil';
    const result = await buildExtractor().extract(text, ANONYMOUS_FARM_CONTEXT, 'text');

    expect(result.ok).toBe(true);
    if (result.ok && result.value.payload.type === 'inventory_purchase') {
      expect(result.value.payload.qty).toBe(10);
      expect(result.value.payload.unitCost).toBeGreaterThan(0);
    }
  });
});
