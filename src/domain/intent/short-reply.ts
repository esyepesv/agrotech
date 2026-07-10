/**
 * Atajo determinista de confirmación/cancelación (D del router en
 * PLAN-v1.1.md §2): un "sí"/"no" corto no necesita pasar por el
 * IntentClassifier (más rápido, más barato, y nunca falla por el LLM).
 * Solo reconoce el texto si es integramente una de estas expresiones
 * cortas; cualquier mensaje largo o con contenido adicional cae a undefined
 * y sigue el flujo normal de clasificación.
 */

const CONFIRM_PHRASES = new Set([
  'si',
  'confirmo',
  'confirmar',
  'dale',
  'listo',
  'ok',
  'okay',
  'correcto',
  'de una',
  'hagale',
  'claro',
  'asi es',
]);

const CANCEL_PHRASES = new Set([
  'no',
  'cancela',
  'cancelar',
  'descarta',
  'descartar',
  'olvidalo',
  'asi no',
  'no confirmo',
  'despues',
  'luego',
  'ahora no',
]);

const MAX_WORDS = 4;

export function parseShortReply(text: string): 'confirm' | 'cancel' | undefined {
  const normalized = normalize(text);
  if (normalized.length === 0) {
    return undefined;
  }

  const wordCount = normalized.split(' ').filter((t) => t.length > 0).length;
  if (wordCount > MAX_WORDS) {
    return undefined;
  }

  if (CONFIRM_PHRASES.has(normalized)) {
    return 'confirm';
  }
  if (CANCEL_PHRASES.has(normalized)) {
    return 'cancel';
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
