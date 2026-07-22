export type Channel = 'telegram' | 'whatsapp';

export type Locale = 'es-CO' | 'es' | 'en';

export type MessageType = 'text' | 'voice';

export interface AudioReference {
  readonly channel: Channel;
  readonly mediaId: string;
}

export interface AudioClip {
  readonly data: Uint8Array;
  readonly mimeType: string;
}

export interface IncomingMessage {
  readonly channel: Channel;
  readonly channelUserId: string;
  readonly messageId: string;
  readonly type: MessageType;
  readonly text?: string;
  readonly audioRef?: AudioReference;
  readonly receivedAt: Date;
}
