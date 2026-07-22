import type { AudioClip } from '../../domain/message/incoming-message.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type {
  SpeechSynthesizer,
  SynthesisError,
  SynthesisOptions,
} from '../../application/ports/speech-synthesizer.js';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const OUTPUT_MIME = 'audio/ogg';

/**
 * Sintetiza voz con la API de ElevenLabs en formato Opus (OGG),
 * apto para notas de voz de Telegram/WhatsApp.
 */
export class ElevenLabsTtsSynthesizer implements SpeechSynthesizer {
  constructor(
    private readonly apiKey: string,
    private readonly voiceId: string,
    private readonly modelId: string,
    private readonly outputFormat: string,
  ) {}

  async synthesize(
    text: string,
    opts: SynthesisOptions,
  ): Promise<Result<AudioClip, SynthesisError>> {
    try {
      const voiceId = opts.voice ?? this.voiceId;
      const url = new URL(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`);
      url.searchParams.set('output_format', this.outputFormat);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/ogg',
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return err({
          kind: 'provider_failure',
          message: `ElevenLabs ${response.status}: ${detail || response.statusText}`,
        });
      }

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
