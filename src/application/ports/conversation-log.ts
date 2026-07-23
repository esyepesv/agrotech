import type { ConversationTurn } from '../../domain/shared/conversation-turn.js';

export interface ConversationLog {
  record(turn: ConversationTurn): Promise<void>;
}
