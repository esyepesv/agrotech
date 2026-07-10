import type OpenAI from 'openai';
import { z } from 'zod';
import type { FarmContext } from '../../domain/farm/farm-context.js';
import type {
  EventSource,
  FarmEventDraft,
  FarmEventPayload,
  Farrowing,
  FeedDelivery,
  HeatConfirmation,
  Insemination,
  InventoryAdjustment,
  InventoryPurchase,
  MedicationApplication,
  PenChange,
  SanitaryTaskDone,
  Weaning,
  WeightControl,
} from '../../domain/farm/farm-event.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { EventExtractor, ExtractionError } from '../../application/ports/event-extractor.js';
import { extractJsonObject } from '../llm/json-output.js';

const SYSTEM_PROMPT = [
  'Eres un extractor de eventos de granja porcícola. A partir del mensaje',
  'del operario, identifica UN SOLO evento (el más reciente/relevante si hay',
  'varios) y devuelve sus datos en JSON. Estos son los tipos posibles y sus',
  'campos EXACTOS (usa esos nombres tal cual, en inglés/camelCase):',
  '',
  '- feed_delivery: itemName, qty, unit ("bulto"|"dosis"|"litro"|"unidad"),',
  '  targetKind ("lot"|"sow"|"general"), lotId?, sowChapeta?, penNumber?',
  '- inventory_purchase: itemName, kind ("concentrado"|"vacuna"|"insumo"),',
  '  qty, unit, unitCost?, brand?',
  '- inventory_adjustment: itemName, newQty, reason?',
  '- insemination: chapeta, occurredOn? (fecha ISO YYYY-MM-DD), boarOrSemen?',
  '- heat_confirmation: chapeta',
  '- pen_change: toPen, chapeta?, lotId?',
  '- weaning: chapeta, pigletsWeaned?, avgWeightKg?',
  '- farrowing: chapeta, bornAlive?, bornDead?, mummified?',
  '- weight_control: avgWeightKg, chapeta?, lotId?',
  '- medication_application: product, chapeta?, lotId?, doseText?',
  '  (NUNCA incluyas needsVetReview: eso lo decide el sistema, no tú)',
  '- sanitary_task_done: taskLabel, chapeta?, lotId?',
  '',
  'Reglas estrictas:',
  '1. Si un campo NO está explícito en el mensaje, OMÍTELO del JSON: nunca',
  '   inventes cantidades, chapetas, productos, costos ni fechas.',
  '2. Usa el contexto (insumos/chapetas conocidas) SOLO para desambiguar',
  '   nombres ya mencionados, nunca para rellenar datos no mencionados.',
  '3. En camposFaltantes lista, en español y legible para el operario, cada',
  '   campo requerido que hayas omitido (ejemplos: "cantidad", "producto",',
  '   "destino", "chapeta", "peso promedio"). Si no falta nada, arreglo vacío.',
  '4. confidence entre 0 y 1: qué tan seguro estás de la extracción.',
  '5. Responde ÚNICAMENTE JSON, sin texto adicional, con esta forma exacta:',
  '   {"payload": {"type": "...", ...campos}, "confidence": 0.0-1.0, "camposFaltantes": ["..."]}',
].join('\n');

// Schema laxo a propósito (todo opcional salvo `type`): un campo requerido
// por el tipo de dominio puede venir ausente si el operario no lo mencionó
// (regla del extractor, nunca inventar). buildPayload() abajo decide, por
// tipo, qué campos son requeridos y arma `camposFaltantes` en consecuencia.
// `type` es `z.string()` (no `z.enum()`) a propósito: así un tipo de evento
// que el modelo invente (o un valor legado) llega a buildPayload() y cae en
// su `default: null` → err({kind:'unrecognized_event'}), en vez de fallar
// como 'invalid_output' genérico en el parseo del schema.
const rawPayloadSchema = z.object({
  type: z.string().min(1),
  itemName: z.string().optional(),
  kind: z.enum(['concentrado', 'vacuna', 'insumo']).optional(),
  qty: z.coerce.number().optional(),
  unit: z.enum(['bulto', 'dosis', 'litro', 'unidad']).optional(),
  targetKind: z.enum(['lot', 'sow', 'general']).optional(),
  lotId: z.string().optional(),
  sowChapeta: z.string().optional(),
  penNumber: z.coerce.number().optional(),
  unitCost: z.coerce.number().optional(),
  brand: z.string().optional(),
  newQty: z.coerce.number().optional(),
  reason: z.string().optional(),
  chapeta: z.string().optional(),
  occurredOn: z.coerce.date().optional(),
  boarOrSemen: z.string().optional(),
  toPen: z.coerce.number().optional(),
  pigletsWeaned: z.coerce.number().optional(),
  avgWeightKg: z.coerce.number().optional(),
  bornAlive: z.coerce.number().optional(),
  bornDead: z.coerce.number().optional(),
  mummified: z.coerce.number().optional(),
  product: z.string().optional(),
  doseText: z.string().optional(),
  taskLabel: z.string().optional(),
});

type RawPayload = z.infer<typeof rawPayloadSchema>;

const extractionResponseSchema = z.object({
  payload: rawPayloadSchema,
  confidence: z.number().min(0).max(1),
  camposFaltantes: z.array(z.string()),
});

// Etiquetas en español para campos requeridos ausentes (task: "cantidad",
// "producto", "destino", ...). Claves = nombre de campo en RawPayload.
const FIELD_LABELS: Partial<Record<keyof RawPayload, string>> = {
  itemName: 'producto',
  qty: 'cantidad',
  unit: 'unidad',
  targetKind: 'destino',
  kind: 'tipo de insumo',
  newQty: 'cantidad nueva',
  chapeta: 'chapeta',
  toPen: 'corral destino',
  avgWeightKg: 'peso promedio',
  product: 'producto aplicado',
  taskLabel: 'tarea',
};

/**
 * Extrae un FarmEventDraft con un LLM vía OpenRouter (mismo patrón que
 * LlmAnswerGenerator/LlmIntentClassifier). Nunca persiste (guardrail del
 * puerto): siempre produce un draft para que LogFarmEvent lo confirme.
 */
export class LlmEventExtractor implements EventExtractor {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async extract(
    text: string,
    ctx: FarmContext,
    source: EventSource,
  ): Promise<Result<FarmEventDraft, ExtractionError>> {
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
      return parseDraftJson(raw, source, text);
    } catch (error) {
      return err({ kind: 'provider_failure', message: describe(error) });
    }
  }
}

/**
 * Parseo puro de la salida del modelo, exportado para tests unitarios sin
 * red. Completa `rawTranscript` (texto de entrada) y `source` (parámetro),
 * como pide el adaptador; nunca inventa valores de negocio para campos
 * ausentes (solo placeholders de tipo, siempre acompañados de la etiqueta
 * correspondiente en camposFaltantes — ver buildPayload).
 */
export function parseDraftJson(
  raw: string,
  source: EventSource,
  rawTranscript: string,
): Result<FarmEventDraft, ExtractionError> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonObject(raw));
  } catch {
    return err({ kind: 'invalid_output', message: `el extractor no devolvió JSON válido: ${raw}` });
  }

  const parsed = extractionResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err({
      kind: 'invalid_output',
      message: `la salida del extractor no cumple el esquema esperado: ${parsed.error.message}`,
    });
  }

  const built = buildPayload(parsed.data.payload);
  if (!built) {
    return err({
      kind: 'unrecognized_event',
      message: `tipo de evento no reconocido: ${parsed.data.payload.type}`,
    });
  }

  // Unión (sin duplicados) de lo que dijo el modelo y lo que detectamos
  // localmente como requerido-y-ausente: protege el invariante "nunca
  // inventar" aunque el modelo olvide declarar un campo como faltante.
  const camposFaltantes = [...new Set([...parsed.data.camposFaltantes, ...built.missing])];

  return ok({
    payload: built.payload,
    confidence: parsed.data.confidence,
    camposFaltantes,
    rawTranscript,
    source,
  });
}

interface BuiltPayload {
  readonly payload: FarmEventPayload;
  readonly missing: string[];
}

/**
 * Arma el payload tipado por caso, registrando en `missing` cada campo
 * requerido por el dominio que vino ausente. Los placeholders usados para
 * satisfacer el tipo ('', 0, 'general') NUNCA se muestran al operario: el
 * caso de uso (LogFarmEvent) solo actúa sobre el draft cuando camposFaltantes
 * está vacío; mientras tanto, solo pregunta por lo que falta.
 */
function buildPayload(raw: RawPayload): BuiltPayload | null {
  const missing: string[] = [];
  const need = (key: keyof RawPayload, present: boolean): void => {
    if (!present) missing.push(FIELD_LABELS[key] ?? key);
  };

  switch (raw.type) {
    case 'feed_delivery': {
      need('itemName', raw.itemName !== undefined);
      need('qty', raw.qty !== undefined);
      need('unit', raw.unit !== undefined);
      need('targetKind', raw.targetKind !== undefined);
      const payload: FeedDelivery = {
        type: 'feed_delivery',
        itemName: raw.itemName ?? '',
        qty: raw.qty ?? 0,
        unit: raw.unit ?? 'bulto',
        targetKind: raw.targetKind ?? 'general',
        lotId: raw.lotId,
        sowChapeta: raw.sowChapeta,
        penNumber: raw.penNumber,
      };
      return { payload, missing };
    }
    case 'inventory_purchase': {
      need('itemName', raw.itemName !== undefined);
      need('kind', raw.kind !== undefined);
      need('qty', raw.qty !== undefined);
      need('unit', raw.unit !== undefined);
      const payload: InventoryPurchase = {
        type: 'inventory_purchase',
        itemName: raw.itemName ?? '',
        kind: raw.kind ?? 'concentrado',
        qty: raw.qty ?? 0,
        unit: raw.unit ?? 'bulto',
        unitCost: raw.unitCost,
        brand: raw.brand,
      };
      return { payload, missing };
    }
    case 'inventory_adjustment': {
      need('itemName', raw.itemName !== undefined);
      need('newQty', raw.newQty !== undefined);
      const payload: InventoryAdjustment = {
        type: 'inventory_adjustment',
        itemName: raw.itemName ?? '',
        newQty: raw.newQty ?? 0,
        reason: raw.reason,
      };
      return { payload, missing };
    }
    case 'insemination': {
      need('chapeta', raw.chapeta !== undefined);
      const payload: Insemination = {
        type: 'insemination',
        chapeta: raw.chapeta ?? '',
        occurredOn: raw.occurredOn,
        boarOrSemen: raw.boarOrSemen,
      };
      return { payload, missing };
    }
    case 'heat_confirmation': {
      need('chapeta', raw.chapeta !== undefined);
      const payload: HeatConfirmation = { type: 'heat_confirmation', chapeta: raw.chapeta ?? '' };
      return { payload, missing };
    }
    case 'pen_change': {
      need('toPen', raw.toPen !== undefined);
      const payload: PenChange = {
        type: 'pen_change',
        chapeta: raw.chapeta,
        lotId: raw.lotId,
        toPen: raw.toPen ?? 0,
      };
      return { payload, missing };
    }
    case 'weaning': {
      need('chapeta', raw.chapeta !== undefined);
      const payload: Weaning = {
        type: 'weaning',
        chapeta: raw.chapeta ?? '',
        pigletsWeaned: raw.pigletsWeaned,
        avgWeightKg: raw.avgWeightKg,
      };
      return { payload, missing };
    }
    case 'farrowing': {
      need('chapeta', raw.chapeta !== undefined);
      const payload: Farrowing = {
        type: 'farrowing',
        chapeta: raw.chapeta ?? '',
        bornAlive: raw.bornAlive,
        bornDead: raw.bornDead,
        mummified: raw.mummified,
      };
      return { payload, missing };
    }
    case 'weight_control': {
      need('avgWeightKg', raw.avgWeightKg !== undefined);
      const payload: WeightControl = {
        type: 'weight_control',
        chapeta: raw.chapeta,
        lotId: raw.lotId,
        avgWeightKg: raw.avgWeightKg ?? 0,
      };
      return { payload, missing };
    }
    case 'medication_application': {
      need('product', raw.product !== undefined);
      const payload: MedicationApplication = {
        type: 'medication_application',
        chapeta: raw.chapeta,
        lotId: raw.lotId,
        product: raw.product ?? '',
        doseText: raw.doseText,
        // Regla dura (§8/§12 de PLAN-v1.1.md): SIEMPRE true, no se infiere
        // del texto ni se deja a criterio del modelo.
        needsVetReview: true,
      };
      return { payload, missing };
    }
    case 'sanitary_task_done': {
      need('taskLabel', raw.taskLabel !== undefined);
      const payload: SanitaryTaskDone = {
        type: 'sanitary_task_done',
        taskLabel: raw.taskLabel ?? '',
        chapeta: raw.chapeta,
        lotId: raw.lotId,
      };
      return { payload, missing };
    }
    default:
      return null;
  }
}

function buildUserPrompt(text: string, ctx: FarmContext): string {
  const pistas: string[] = [];
  if (ctx.itemNames.length > 0) {
    pistas.push(`Insumos conocidos de su inventario: ${ctx.itemNames.join(', ')}.`);
  }
  if (ctx.chapetas.length > 0) {
    pistas.push(`Chapetas conocidas: ${ctx.chapetas.join(', ')}.`);
  }
  const contexto = pistas.length > 0 ? `CONTEXTO:\n${pistas.join('\n')}\n\n` : '';
  return `${contexto}MENSAJE:\n${text}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en extracción de evento';
}
