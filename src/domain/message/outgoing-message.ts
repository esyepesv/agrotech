import type { AudioClip, Channel, MessageType } from './incoming-message.js';

export interface OutgoingMessage {
  readonly channel: Channel;
  readonly channelUserId: string;
  readonly type: MessageType;
  readonly text: string;
  readonly audio?: AudioClip;
}
