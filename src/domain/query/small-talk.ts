/**
 * Detección de "small talk" (saludos y agradecimientos) para no mandar esos
 * mensajes al RAG: un "hola" no tiene contexto en el corpus y caería en el
 * fallback de "no tengo información confiable", que es una mala bienvenida.
 * Se responde con un mensaje social antes de tocar recuperación/LLM.
 */
export type SmallTalk = 'greeting' | 'thanks';

// Palabras que, solas o combinadas, forman un saludo natural en el campo
// colombiano ("hola", "buenas", "buenos días", "qué más pues", "hey").
const GREETING_WORDS = new Set([
  'hola',
  'holis',
  'ola',
  'buenas',
  'buenos',
  'buen',
  'dia',
  'dias',
  'tarde',
  'tardes',
  'noche',
  'noches',
  'hey',
  'ey',
  'hi',
  'hello',
  'saludos',
  'saludo',
  'que',
  'mas',
  'tal',
  'pues',
  'como',
  'estas',
  'esta',
  'va',
  'todo',
  'bien',
  'y',
]);

// Al menos una de estas debe aparecer para tratar el mensaje como saludo
// (evita clasificar "todo bien" o "y" sueltos como saludo).
const GREETING_TRIGGERS = new Set([
  'hola',
  'holis',
  'ola',
  'buenas',
  'buenos',
  'buen',
  'hey',
  'ey',
  'hi',
  'hello',
  'saludos',
  'saludo',
  'que',
]);

// Agradecimientos ("gracias", "muchas gracias", "mil gracias, muy amable").
const THANKS_WORDS = new Set([
  'gracias',
  'muchas',
  'mil',
  'muy',
  'amable',
  'agradezco',
  'vale',
  'ok',
  'listo',
  'perfecto',
]);

const MAX_TOKENS = 4;

/**
 * Clasifica un texto como saludo o agradecimiento SOLO cuando todo el mensaje
 * es social (todas sus palabras pertenecen al conjunto correspondiente y es
 * corto). Cualquier término sustantivo ("concentrado", "hembra") hace que
 * devuelva `undefined` y el flujo siga al RAG normal.
 */
export function classifySmallTalk(text: string): SmallTalk | undefined {
  const tokens = normalize(text)
    .split(' ')
    .filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) {
    return undefined;
  }

  if (tokens.some((t) => t === 'gracias') && tokens.every((t) => THANKS_WORDS.has(t))) {
    return 'thanks';
  }

  if (tokens.some((t) => GREETING_TRIGGERS.has(t)) && tokens.every((t) => GREETING_WORDS.has(t))) {
    return 'greeting';
  }

  return undefined;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .replace(/[^a-z\s]/g, ' ') // quita signos (¿?!, emojis, dígitos)
    .replace(/\s+/g, ' ')
    .trim();
}
