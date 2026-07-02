import type { Channel } from '../message/incoming-message.js';
import type { SafetyAction } from '../safety/safety-decision.js';

/**
 * Turno de conversación para métricas. El adaptador de persistencia
 * DEBE hashear channelUserId antes de almacenarlo (privacidad, sección 9).
 */
export interface ConversationTurn {
  readonly channel: Channel;
  readonly channelUserId: string;
  readonly questionText: string;
  readonly answerText: string;
  readonly action: SafetyAction;
  readonly latencyMs: number;
  readonly createdAt: Date;
}
