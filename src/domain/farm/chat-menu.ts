import type { ReplyOption } from '../message/reply-option.js';

export const CHAT_MENU_OPTIONS: readonly ReplyOption[] = [
  { id: 'menu:register', label: 'Registrarme' },
  { id: 'menu:login', label: 'Iniciar sesión' },
];

const MENU_TEXT =
  '¡Hola! Soy PorcIA, tu asistente porcícola. ¿En qué te puedo ayudar?\n\n' +
  'Puedes escribirme lo que necesites, o tocar un botón si quieres crear tu cuenta o entrar a una que ya tengas.';

export function chatMenuReply(): { text: string; options: readonly ReplyOption[]; layout: 'buttons' } {
  return { text: MENU_TEXT, options: CHAT_MENU_OPTIONS, layout: 'buttons' };
}

export function greetingFor(displayName?: string): string {
  return displayName === undefined
    ? '¡Hola de nuevo! Ya reconocí tu número. ¿En qué te ayudo?'
    : `¡Hola, ${displayName}! Ya reconocí tu número. ¿En qué te ayudo?`;
}
