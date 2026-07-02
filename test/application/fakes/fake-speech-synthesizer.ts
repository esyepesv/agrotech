import type { AudioClip } from '../../../src/domain/message/incoming-message.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { err, ok } from '../../../src/domain/shared/result.js';
import type {
  SpeechSynthesizer,
  SynthesisError,
  SynthesisOptions,
} from '../../../src/application/ports/speech-synthesizer.js';

export class FakeSpeechSynthesizer implements SpeechSynthesizer {
  readonly synthesizedTexts: string[] = [];

  constructor(private readonly shouldFail = false) {}

  async synthesize(
    text: string,
    _opts: SynthesisOptions,
  ): Promise<Result<AudioClip, SynthesisError>> {
    this.synthesizedTexts.push(text);
    if (this.shouldFail) {
      return err({ kind: 'provider_failure', message: 'tts caído' });
    }
    return ok({ data: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg' });
  }
}
