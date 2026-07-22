import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { ElevenLabsTtsSynthesizer } from '../../src/infrastructure/speech/elevenlabs-tts-synthesizer.js';
import { WhisperTranscriber } from '../../src/infrastructure/speech/whisper-transcriber.js';

/**
 * Roundtrip de integración real: sintetiza un texto con ElevenLabs TTS y
 * transcribe el audio resultante con Whisper, verificando que el pipeline
 * de voz completo (síntesis → transcripción) funciona contra las APIs
 * reales. Se salta si faltan credenciales en el entorno (sección 16).
 */
describe.skipIf(!process.env.OPENAI_API_KEY || !process.env.ELEVENLABS_API_KEY)(
  'TTS + Whisper roundtrip (integración real)',
  () => {
    it('transcribe de vuelta un texto sintetizado a voz', async () => {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const synthesizer = new ElevenLabsTtsSynthesizer(
        process.env.ELEVENLABS_API_KEY!,
        process.env.ELEVENLABS_VOICE_ID ?? 'TsKSGPuG26FpNj0JzQBq',
        process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
        process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'opus_48000_64',
      );
      const transcriber = new WhisperTranscriber(client, process.env.STT_MODEL ?? 'whisper-1');

      const originalText = 'Buenos días, esto es una prueba de la nota de voz.';
      const synthesized = await synthesizer.synthesize(originalText, { locale: 'es-CO' });

      expect(synthesized.ok).toBe(true);
      if (!synthesized.ok) {
        return;
      }

      const transcribed = await transcriber.transcribe(synthesized.value);

      expect(transcribed.ok).toBe(true);
      if (transcribed.ok) {
        expect(transcribed.value.text.toLowerCase()).toContain('prueba');
      }
    });
  },
);
