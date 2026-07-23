import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationTurn } from '../../domain/shared/conversation-turn.js';
import type { ConversationLog } from '../../application/ports/conversation-log.js';

const TABLE = 'conversation_turn';

/**
 * Registra turnos de conversación en Supabase para métricas (sección 15).
 * Hashea channelUserId con HMAC-SHA256 + pepper secreto (#2 hardening)
 * antes de persistir: nunca se guarda el identificador del usuario en claro
 * ni con un hash pelado (reproducible por fuerza bruta/diccionario), sino
 * con una clave (`salt`, USER_ID_SALT) que solo conoce el servidor.
 */
export class SupabaseConversationLog implements ConversationLog {
  constructor(
    private readonly client: SupabaseClient,
    private readonly salt: string,
  ) {}

  async record(turn: ConversationTurn): Promise<void> {
    const { error } = await this.client.from(TABLE).insert({
      channel: turn.channel,
      user_hash: hashUserId(turn.channelUserId, this.salt),
      question_text: turn.questionText,
      answer_text: turn.answerText,
      action: turn.action,
      latency_ms: turn.latencyMs,
      created_at: turn.createdAt.toISOString(),
    });

    if (error !== null) {
      throw new Error(`fallo al registrar turno: ${error.message}`);
    }
  }
}

function hashUserId(channelUserId: string, salt: string): string {
  return createHmac('sha256', salt).update(channelUserId).digest('hex');
}
