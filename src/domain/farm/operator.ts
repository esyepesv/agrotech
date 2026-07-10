import type { FarmId } from './farm.js';

export type OperatorId = string;

export type OperatorRole = 'operario' | 'admin';

// Identidad de quien conversa por el canal (Telegram/WhatsApp). El hash
// reemplaza el channelUserId crudo (mismo hasheo con sal secreta que v1).
export interface Operator {
  readonly id: OperatorId;
  readonly farmId: FarmId;
  readonly channelUserHash: string;
  readonly displayName?: string;
  readonly role: OperatorRole;
}
