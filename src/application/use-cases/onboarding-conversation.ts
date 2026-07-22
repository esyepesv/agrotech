import type { FarmReply } from './farm-reply.js';

// Contexto que solo el adaptador de entrada puede resolver (arquitectura-v1.2.md
// §3: "la verificación de posesión del celular es responsabilidad del
// adaptador, nunca del caso de uso"). `HandleIncomingMessage` lo arma a
// partir del `IncomingMessage` y se lo pasa a `handle()`.
export interface OnboardingContext {
  readonly channel: 'whatsapp' | 'telegram';
  readonly channelUserId: string;
  // E.164 si el canal ya prueba de qué número escribe la persona (spec 001
  // §4.1.2): WhatsApp siempre (channelUserId ES el celular); Telegram solo
  // si el webhook resolvió un contacto compartido en ESTE mensaje.
  readonly detectedPhone?: string;
  // Habilita las reglas de §4.1.3 (lectura dígito por dígito, correo no se
  // dicta) sin que el adaptador conversacional necesite conocer Whisper.
  readonly inputWasVoice: boolean;
}

/**
 * Forma estructural que `HandleIncomingMessage` espera para la rama de
 * onboarding (arquitectura-v1.2.md §4: "el adaptador conversacional de
 * registro implementa la misma forma estructural... solo cambia qué
 * instancia se inyecta en config/container.ts"). `RegisterFarmAndUserConversation`
 * es la única implementación real; el tipo vive separado para que
 * `HandleIncomingMessage` no dependa de esa clase concreta.
 */
export interface OnboardingConversation {
  handle(channelUserHash: string, text: string, ctx: OnboardingContext): Promise<FarmReply>;
}
