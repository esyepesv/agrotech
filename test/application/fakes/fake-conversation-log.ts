import type { ConversationTurn } from '../../../src/domain/shared/conversation-turn.js';
import type { ConversationLog } from '../../../src/application/ports/conversation-log.js';

export class FakeConversationLog implements ConversationLog {
  readonly turns: ConversationTurn[] = [];

  async record(turn: ConversationTurn): Promise<void> {
    this.turns.push(turn);
  }
}
