import type {
  AudioClip,
  AudioReference,
  IncomingMessage,
} from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import type { Result } from '../../domain/shared/result.js';

export interface ChannelError {
  readonly kind: 'fetch_failed' | 'send_failed';
  readonly message: string;
}

export interface ChannelGateway {
  fetchAudio(ref: AudioReference): Promise<Result<AudioClip, ChannelError>>;
  send(message: OutgoingMessage): Promise<Result<void, ChannelError>>;
  /** Señal nativa de "escribiendo…". Best-effort: nunca lanza ni bloquea el flujo. */
  indicateTyping(message: IncomingMessage): Promise<void>;
}
