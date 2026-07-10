import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256 del identificador de canal del usuario con pepper secreto
 * (USER_ID_SALT). Es el MISMO hasheo que usa SupabaseConversationLog desde
 * el hardening #2 de v1; se extrae como helper compartido (aditivo, D2 de
 * PLAN-v1.1.md) porque en v1.1 también identifica al operario
 * (operator.channel_user_hash) y la clave del pending de un usuario aún no
 * registrado. Un mismo usuario debe producir el mismo hash en ambas tablas.
 */
export function hashUserId(channelUserId: string, salt: string): string {
  return createHmac('sha256', salt).update(channelUserId).digest('hex');
}
