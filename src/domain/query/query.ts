import type { Locale } from '../message/incoming-message.js';

export interface Query {
  readonly text: string;
  readonly locale: Locale;
}

const DEFAULT_LOCALE: Locale = 'es-CO';

export function createQuery(rawText: string, locale: Locale = DEFAULT_LOCALE): Query {
  return { text: normalizeQuestion(rawText), locale };
}

function normalizeQuestion(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}
