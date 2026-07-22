import type { Channel } from './incoming-message.js';

/**
 * Opción de respuesta cerrada (botón o fila de lista). El id es namespaced
 * (`reg:<campo>:<valor>`, ver `optionId`) para que el caso de uso detecte
 * botones obsoletos: si el id no corresponde al `nextField` vigente, la
 * pulsación se rechaza sin sobreescribir un campo ya confirmado (spec 001
 * §4.1.1, tabla de errores §5 "Botón obsoleto").
 */
export interface ReplyOption {
  readonly id: string;
  readonly label: string;
}

export type InteractiveLayout = 'buttons' | 'list';

/**
 * Mensaje con opciones cerradas, agnóstico del canal. El núcleo (caso de
 * uso) solo produce esto; cada `InteractiveGateway` decide cómo pintarlo
 * (reply buttons / inline keyboard / list message) o si degradar a texto
 * numerado (`renderNumberedFallback`) cuando el canal no soporta
 * interactivos o el envío falla.
 */
export interface InteractiveMessage {
  readonly channel: Channel;
  readonly channelUserId: string;
  readonly body: string;
  readonly options: readonly ReplyOption[];
  readonly layout: InteractiveLayout;
}

export interface ParsedOptionId {
  readonly field: string;
  readonly value: string;
}

const OPTION_ID_PREFIX = 'reg';

/** Construye el id namespaced de una opción, p. ej. `reg:tipo_persona:natural`. */
export function optionId(field: string, value: string): string {
  return `${OPTION_ID_PREFIX}:${field}:${value}`;
}

/**
 * Inverso de `optionId`. Devuelve `undefined` si `raw` no tiene la forma
 * `reg:<campo>:<valor>` — así el caso de uso distingue un id de opción de
 * texto libre sin adivinar.
 */
export function parseOptionId(raw: string): ParsedOptionId | undefined {
  const parts = raw.split(':');
  if (parts.length !== 3) {
    return undefined;
  }
  const [prefix, field, value] = parts;
  if (prefix !== OPTION_ID_PREFIX || field === undefined || field.length === 0) {
    return undefined;
  }
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return { field, value };
}

/**
 * Fallback de texto plano cuando no hay interactivos (canal sin soporte,
 * envío interactivo fallido, o cliente que no los renderiza). Numera las
 * opciones en el cuerpo para que el usuario responda con el número — el
 * mismo texto que `matchOption` sabe interpretar de vuelta.
 */
export function renderNumberedFallback(body: string, options: readonly ReplyOption[]): string {
  const lines = options.map((option, index) => `${index + 1}. ${option.label}`);
  return [body, '', ...lines].join('\n');
}

// Ordinales en español hablado ("la primera", "el segundo…") — cubre hasta
// 10 porque ningún paso de este spec ofrece más de 10 opciones (list message
// de WhatsApp topa en 10 filas).
const ORDINAL_WORDS: Record<string, number> = {
  primero: 1,
  primera: 1,
  segundo: 2,
  segunda: 2,
  tercero: 3,
  tercera: 3,
  cuarto: 4,
  cuarta: 4,
  quinto: 5,
  quinta: 5,
  sexto: 6,
  sexta: 6,
  septimo: 7,
  septima: 7,
  setimo: 7,
  setima: 7,
  octavo: 8,
  octava: 8,
  noveno: 9,
  novena: 9,
  decimo: 10,
  decima: 10,
};

/**
 * Empareja una respuesta libre (texto o voz transcrita) con una opción, en
 * este orden: (1) id exacto — la pulsación real de un botón/fila llega así;
 * (2) número directo ("1", "2"…); (3) ordinal hablado ("la primera"); (4)
 * coincidencia de etiqueta normalizada (sin tildes/mayúsculas/puntuación),
 * completa o por su primera palabra significativa (para que "SÍ" empareje
 * con la etiqueta "Sí, confirmar"). Devuelve `undefined` si nada calza —
 * el llamador decide si repreguntar o degradar (spec 001 §5).
 */
export function matchOption(
  input: string,
  options: readonly ReplyOption[],
): ReplyOption | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const byId = options.find((option) => option.id === trimmed);
  if (byId !== undefined) {
    return byId;
  }

  const normalized = normalizeText(trimmed);
  if (normalized.length === 0) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    return options[Number(normalized) - 1];
  }

  const tokens = normalized.split(' ');
  for (const token of tokens) {
    const ordinal = ORDINAL_WORDS[token];
    if (ordinal !== undefined) {
      return options[ordinal - 1];
    }
  }

  for (const option of options) {
    const normalizedLabel = normalizeText(option.label);
    if (normalizedLabel === normalized) {
      return option;
    }
    const labelWords = normalizedLabel.split(' ');
    if (labelWords.includes(normalized) || labelWords[0] === normalized) {
      return option;
    }
  }

  return undefined;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .replace(/[^a-z0-9\s]/g, ' ') // quita signos/emojis (conserva dígitos)
    .replace(/\s+/g, ' ')
    .trim();
}
