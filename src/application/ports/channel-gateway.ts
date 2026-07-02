import type { AudioClip, AudioReference } from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import type { Result } from '../../domain/shared/result.js';

export interface ChannelError {
  readonly kind: 'fetch_failed' | 'send_failed';
  readonly message: string;
}

export interface ChannelGateway {
  fetchAudio(ref: AudioReference): Promise<Result<AudioClip, ChannelError>>;
  send(message: OutgoingMessage): Promise<Result<void, ChannelError>>;
}
