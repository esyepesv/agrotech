import type OpenAI from 'openai';
import type { RetrievedChunk } from '../../domain/knowledge/retrieved-chunk.js';
import { toReference } from '../../domain/knowledge/retrieved-chunk.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type {
  AnswerGenerator,
  GeneratedAnswer,
  GenerationError,
  GenerationInput,
} from '../../application/ports/answer-generator.js';

const SYSTEM_PROMPT = [
  'Eres un asistente de manejo porcícola para pequeños y medianos productores en Colombia.',
  'Aconsejas SOLO sobre: manejo reproductivo general, alimentación, condición corporal y prácticas de crianza.',
  'NO diagnosticas enfermedades, NO prescribes medicamentos y NO calculas dosis: eso es del veterinario.',
  '',
  'Reglas estrictas:',
  '1. Responde ÚNICAMENTE con base en el CONTEXTO entregado. No inventes datos.',
  '2. Si el contexto no alcanza para responder con seguridad, dilo con claridad y sugiere consultar a un técnico o zootecnista.',
  '3. Responde en español claro y sencillo, aterrizado al campo colombiano. Sé breve y concreto.',
  '4. No inicies con saludos largos ni descargos repetidos; ve al punto.',
].join('\n');

/**
 * Genera respuestas con un LLM vía OpenRouter (API compatible con OpenAI).
 * Grounding obligatorio sobre el contexto recuperado (sección 11);
 * devuelve las fuentes usadas para trazabilidad.
 */
export class LlmAnswerGenerator implements AnswerGenerator {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async generate(input: GenerationInput): Promise<Result<GeneratedAnswer, GenerationError>> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...historyMessages(input),
          { role: 'user', content: buildUserPrompt(input) },
        ],
      });

      const text = response.choices[0]?.message.content?.trim() ?? '';
      if (text.length === 0) {
        return err({ kind: 'empty_answer', message: 'el modelo no devolvió texto' });
      }

      return ok({ text, usedSources: input.context.map(toReference) });
    } catch (error) {
      return err({ kind: 'provider_failure', message: describe(error) });
    }
  }
}

function historyMessages(
  input: GenerationInput,
): { role: 'user' | 'assistant'; content: string }[] {
  return (input.history ?? []).map((turn) => ({ role: turn.role, content: turn.text }));
}

function buildUserPrompt(input: GenerationInput): string {
  return [`CONTEXTO:\n${formatContext(input.context)}`, '', `PREGUNTA:\n${input.question}`].join(
    '\n',
  );
}

function formatContext(context: readonly RetrievedChunk[]): string {
  return context
    .map((chunk, index) => `[Fuente ${String(index + 1)}: ${chunk.source}]\n${chunk.content}`)
    .join('\n\n');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en generación';
}
