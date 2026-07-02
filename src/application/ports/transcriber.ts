import type { AudioClip, Locale } from '../../domain/message/incoming-message.js';
import type { Result } from '../../domain/shared/result.js';

export interface Transcript {
  readonly text: string;
  readonly language: Locale;
  readonly confidence: number;
}

export interface TranscriberError {
  readonly kind: 'empty_transcription' | 'provider_failure';
  readonly message: string;
}

export interface Transcriber {
  transcribe(audio: AudioClip): Promise<Result<Transcript, TranscriberError>>;
}
