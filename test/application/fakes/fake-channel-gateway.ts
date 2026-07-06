import type { AudioClip, AudioReference } from '../../../src/domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../../src/domain/message/outgoing-message.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { err, ok } from '../../../src/domain/shared/result.js';
import type {
  ChannelError,
  ChannelGateway,
} from '../../../src/application/ports/channel-gateway.js';

export class FakeChannelGateway implements ChannelGateway {
  readonly sent: OutgoingMessage[] = [];

  constructor(
    private readonly audioFetchFails = false,
    private readonly sendResult: Result<void, ChannelError> = ok(undefined),
  ) {}

  async fetchAudio(_ref: AudioReference): Promise<Result<AudioClip, ChannelError>> {
    if (this.audioFetchFails) {
      return err({ kind: 'fetch_failed', message: 'media no disponible' });
    }
    return ok({ data: new Uint8Array([9, 9, 9]), mimeType: 'audio/ogg' });
  }

  async send(message: OutgoingMessage): Promise<Result<void, ChannelError>> {
    this.sent.push(message);
    return this.sendResult;
  }
}
