import type { MessageType } from '../message/incoming-message.js';
import type { KnowledgeReference } from '../knowledge/retrieved-chunk.js';

export interface Answer {
  readonly text: string;
  readonly sources: readonly KnowledgeReference[];
  readonly deliverAs: MessageType;
}
