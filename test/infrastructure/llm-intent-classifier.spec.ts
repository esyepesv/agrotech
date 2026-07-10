import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { LlmIntentClassifier } from '../../src/infrastructure/intent/llm-intent-classifier.js';
import { ANONYMOUS_FARM_CONTEXT } from '../../src/domain/farm/farm-context.js';

/**
 * Test de integración real contra OpenRouter. Se salta si no hay
 * LLM_API_KEY en el entorno (mismo patrón que llm-answer-generator.spec.ts).
 */
// La construcción del cliente/clasificador vive DENTRO de cada `it()` (no en
// el cuerpo del describe): el cuerpo del describe se ejecuta siempre durante
// la recolección de tests, incluso si describe.skipIf() termina saltando su
// ejecución — construir el cliente ahí reventaría por falta de OPENAI_API_KEY/
// LLM_API_KEY aun estando "saltado" (mismo patrón que llm-answer-generator.spec.ts).
describe.skipIf(!process.env.LLM_API_KEY)('LlmIntentClassifier (integración real)', () => {
  function buildClassifier(): LlmIntentClassifier {
    const client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
    });
    return new LlmIntentClassifier(
      client,
      process.env.INTENT_MODEL ?? 'anthropic/claude-haiku-4.5',
    );
  }

  it('reporta un hecho de alimentación → log_event', async () => {
    const result = await buildClassifier().classify(
      'hoy le di 3 bultos de solla a la ceba',
      ANONYMOUS_FARM_CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('log_event');
    }
  });

  it('pregunta por su propio inventario → query_state', async () => {
    const result = await buildClassifier().classify(
      '¿cuánto concentrado me queda?',
      ANONYMOUS_FARM_CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('query_state');
    }
  });

  it('pregunta de conocimiento general → question', async () => {
    const result = await buildClassifier().classify(
      '¿cada cuánto entra en celo una cerda?',
      ANONYMOUS_FARM_CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('question');
    }
  });
});
