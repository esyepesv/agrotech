import type OpenAI from 'openai';
import { z } from 'zod';
import type { FarmContext } from '../../domain/farm/farm-context.js';
import type { Intent } from '../../domain/intent/intent.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { ClassifierError, IntentClassifier } from '../../application/ports/intent-classifier.js';

const SYSTEM_PROMPT = [
  'Eres el router de un asistente porcícola por WhatsApp/Telegram. Tu única',
  'tarea es clasificar el mensaje del operario en UNA de estas categorías:',
  '',
  '- question: pregunta de conocimiento o manejo general (alimentación, celo,',
  '  destete, enfermedades, etc.), sin reportar un hecho propio.',
  '- log_event: reporta un hecho ya ocurrido en SU granja (dio comida, compró',
  '  insumo, inseminó, confirmó celo, cambió de corral, destetó, parió,',
  '  pesó, aplicó un medicamento, hizo una tarea sanitaria).',
  '- query_state: pregunta por SUS propios datos (cuánto inventario le',
  '  queda, cuánto ha gastado, estado de una cerda o lote específico).',
  '- onboarding: quiere registrarse o crear su granja en el sistema.',
  '- confirm: confirma algo que se le preguntó (sí, dale, confirmo, correcto).',
  '- cancel: rechaza o cancela algo que se le preguntó (no, cancela, mentira).',
  '- unknown: no se puede determinar con las categorías anteriores.',
  '',
  'Reglas:',
  '1. Si el mensaje es ambiguo entre salud animal y un simple registro,',
  '   prioriza "question" (un asesor debe poder intervenir; el registro',
  '   nunca se pierde porque la confirmación explícita lo cubre después).',
  '2. Responde SOLO con JSON, sin texto adicional, exactamente así:',
  '   {"kind": "question|log_event|query_state|onboarding|confirm|cancel|unknown", "confidence": 0.0-1.0}',
].join('\n');

const intentJsonSchema = z.object({
  kind: z.enum([
    'question',
    'log_event',
    'query_state',
    'onboarding',
    'confirm',
    'cancel',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
});

/**
 * Clasifica intención con un LLM vía OpenRouter (mismo cliente/patrón que
 * LlmAnswerGenerator). Modelo pequeño y prompt corto a propósito: corre en
 * cada mensaje (R1 de PLAN-v1.1.md).
 */
export class LlmIntentClassifier implements IntentClassifier {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async classify(text: string, ctx: FarmContext): Promise<Result<Intent, ClassifierError>> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(text, ctx) },
        ],
      });

      const raw = response.choices[0]?.message.content?.trim() ?? '';
      return parseIntentJson(raw);
    } catch (error) {
      return err({ kind: 'provider_failure', message: describe(error) });
    }
  }
}

/**
 * Parseo puro de la salida del modelo, exportado para tests unitarios sin
 * red (JSON válido/roto, kind desconocido, confidence fuera de rango).
 */
export function parseIntentJson(raw: string): Result<Intent, ClassifierError> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return err({
      kind: 'invalid_output',
      message: `el clasificador no devolvió JSON válido: ${raw}`,
    });
  }

  const parsed = intentJsonSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err({
      kind: 'invalid_output',
      message: `la salida del clasificador no cumple el esquema esperado: ${parsed.error.message}`,
    });
  }

  return ok({ kind: parsed.data.kind, confidence: parsed.data.confidence });
}

function buildUserPrompt(text: string, ctx: FarmContext): string {
  const registrado = ctx.operatorId !== null;
  const pistas = [
    `Operario registrado: ${registrado ? 'sí' : 'no'}.`,
    `Tiene un pendiente de confirmación: ${ctx.hasPending ? 'sí' : 'no'}.`,
  ];
  if (ctx.itemNames.length > 0) {
    pistas.push(`Insumos conocidos de su inventario: ${ctx.itemNames.join(', ')}.`);
  }
  if (ctx.chapetas.length > 0) {
    pistas.push(`Chapetas conocidas: ${ctx.chapetas.join(', ')}.`);
  }
  return [`CONTEXTO:\n${pistas.join('\n')}`, '', `MENSAJE:\n${text}`].join('\n');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en clasificación de intención';
}
