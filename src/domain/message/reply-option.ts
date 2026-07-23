import type { Channel } from './incoming-message.js';
import { parseShortReply } from '../intent/short-reply.js';

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

  const exactLabel = options.find((option) => normalizeText(option.label) === normalized);
  if (exactLabel !== undefined) {
    return exactLabel;
  }

  // Una palabra suelta solo decide si señala a UNA opción. Antes se devolvía
  // la primera que la contuviera, así que "cédula" elegía en silencio entre
  // cédula de ciudadanía y de extranjería.
  const byWord = options.filter((option) => {
    const labelWords = normalizeText(option.label).split(' ');
    return labelWords.includes(normalized) || labelWords[0] === normalized;
  });
  if (byWord.length === 1) {
    return byWord[0];
  }

  return matchAffirmation(normalized, options) ?? matchByDistinctiveWords(tokens, options);
}

/**
 * "dale", "listo", "está bien", "para nada"… en opciones de sí/no. Reutiliza
 * el vocabulario de `parseShortReply` (el mismo atajo determinista del router
 * de v1.1) en vez de mantener una segunda lista de sinónimos; la convención
 * de ids `reg:<paso>:<valor>` dice cuál opción es la afirmativa.
 */
function matchAffirmation(
  normalized: string,
  options: readonly ReplyOption[],
): ReplyOption | undefined {
  const reply = parseShortReply(normalized);
  if (reply === undefined) {
    return undefined;
  }
  const wanted = reply === 'confirm' ? AFFIRMATIVE_VALUES : NEGATIVE_VALUES;
  const matches = options.filter((option) => {
    const value = parseOptionId(option.id)?.value;
    return value !== undefined && wanted.has(value);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Gana la opción con más palabras **distintivas** presentes en lo dictado.
 * Distintiva = aparece en una sola etiqueta: así "soy" no decide nada entre
 * "Soy dueño o administrador" y "Soy trabajador", pero "dueño" sí. Si nada
 * puntúa o hay empate, no se adivina.
 */
function matchByDistinctiveWords(
  tokens: readonly string[],
  options: readonly ReplyOption[],
): ReplyOption | undefined {
  const wordsPerOption = options.map(
    (option) => new Set(normalizeText(option.label).split(' ').filter(isMeaningfulWord)),
  );

  const distinctive = wordsPerOption.map(
    (words, index) =>
      new Set(
        [...words].filter((word) =>
          wordsPerOption.every((other, otherIndex) => otherIndex === index || !other.has(word)),
        ),
      ),
  );

  const spoken = new Set(tokens);
  const scores = distinctive.map((words) => [...words].filter((word) => spoken.has(word)).length);

  const best = Math.max(...scores, 0);
  if (best === 0) {
    return undefined;
  }
  const winners = scores.reduce<number[]>(
    (acc, score, index) => (score === best ? [...acc, index] : acc),
    [],
  );
  return winners.length === 1 ? options[winners[0] as number] : undefined;
}

// Palabras que no distinguen nada por sí solas en español hablado. "sí" y
// "no" quedan FUERA a propósito: son justo las que deciden en los pasos de
// confirmación ("sí, confirmo").
const FILLER_WORDS = new Set([
  'soy',
  'es',
  'era',
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'mi',
  'mis',
  'yo',
  'me',
  'quiero',
  'por',
  'favor',
  'que',
  'y',
  'o',
  'a',
  'en',
  'con',
  'para',
  'se',
  'lo',
  'le',
  'esta',
  'este',
  'esa',
  'ese',
  'eso',
  'mas',
  'muy',
]);

function isMeaningfulWord(word: string): boolean {
  return word.length > 1 && !FILLER_WORDS.has(word);
}

const AFFIRMATIVE_VALUES = new Set(['yes', 'confirm', 'aprobar']);
const NEGATIVE_VALUES = new Set(['no', 'cancel', 'retry', 'rechazar']);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .replace(/[^a-z0-9\s]/g, ' ') // quita signos/emojis (conserva dígitos)
    .replace(/\s+/g, ' ')
    .trim();
}
