import { toFile } from 'openai';
import type OpenAI from 'openai';
import type { AudioClip } from '../../domain/message/incoming-message.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type {
  Transcriber,
  TranscriberError,
  Transcript,
} from '../../application/ports/transcriber.js';

/**
 * Transcribe voz con la API de OpenAI (Whisper). Traduce fallos del
 * proveedor a TranscriberError; no decide lógica de negocio.
 */
export class WhisperTranscriber implements Transcriber {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async transcribe(audio: AudioClip): Promise<Result<Transcript, TranscriberError>> {
    try {
      const file = await toFile(audio.data, filenameFor(audio.mimeType), {
        type: audio.mimeType,
      });
      const response = await this.client.audio.transcriptions.create({
        file,
        model: this.model,
        response_format: 'json',
        language: 'es',
      });

      const text = response.text.trim();
      if (text.length === 0) {
        return err({ kind: 'empty_transcription', message: 'transcripción vacía' });
      }

      return ok({ text, language: 'es-CO', confidence: 1 });
    } catch (error) {
      return err({ kind: 'provider_failure', message: describe(error) });
    }
  }
}

function filenameFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'audio.ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'audio.mp3';
  if (mimeType.includes('wav')) return 'audio.wav';
  if (mimeType.includes('m4a') || mimeType.includes('mp4')) return 'audio.m4a';
  return 'audio.ogg';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en transcripción';
}
