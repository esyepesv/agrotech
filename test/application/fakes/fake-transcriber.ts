import type { AudioClip } from '../../../src/domain/message/incoming-message.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';
import type {
  Transcriber,
  TranscriberError,
  Transcript,
} from '../../../src/application/ports/transcriber.js';

export class FakeTranscriber implements Transcriber {
  readonly calls: AudioClip[] = [];

  constructor(
    private readonly result: Result<Transcript, TranscriberError> = ok({
      text: '¿cada cuánto debo alimentar una hembra lactante?',
      language: 'es-CO',
      confidence: 0.95,
    }),
  ) {}

  async transcribe(audio: AudioClip): Promise<Result<Transcript, TranscriberError>> {
    this.calls.push(audio);
    return this.result;
  }
}
