import type OpenAI from 'openai';
import type { AudioClip } from '../../domain/message/incoming-message.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type {
  SpeechSynthesizer,
  SynthesisError,
  SynthesisOptions,
} from '../../application/ports/speech-synthesizer.js';

const OUTPUT_MIME = 'audio/ogg';

/**
 * Sintetiza voz con la API de OpenAI (TTS) en formato OGG/opus,
 * apto para notas de voz de Telegram/WhatsApp.
 */
export class TtsSynthesizer implements SpeechSynthesizer {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly voice: string,
  ) {}

  async synthesize(
    text: string,
    opts: SynthesisOptions,
  ): Promise<Result<AudioClip, SynthesisError>> {
    try {
      const response = await this.client.audio.speech.create({
        model: this.model,
        voice: opts.voice ?? this.voice,
        input: text,
        response_format: 'opus',
      });

      const buffer = new Uint8Array(await response.arrayBuffer());
      return ok({ data: buffer, mimeType: OUTPUT_MIME });
    } catch (error) {
      return err({ kind: 'provider_failure', message: describe(error) });
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en síntesis';
}
