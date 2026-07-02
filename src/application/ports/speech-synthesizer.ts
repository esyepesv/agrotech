import type { AudioClip, Locale } from '../../domain/message/incoming-message.js';
import type { Result } from '../../domain/shared/result.js';

export interface SynthesisOptions {
  readonly locale: Locale;
  readonly voice?: string;
}

export interface SynthesisError {
  readonly kind: 'provider_failure';
  readonly message: string;
}

export interface SpeechSynthesizer {
  synthesize(text: string, opts: SynthesisOptions): Promise<Result<AudioClip, SynthesisError>>;
}
