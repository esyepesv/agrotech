import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { buildSynthesizer } from '../../src/config/container.js';
import { ElevenLabsTtsSynthesizer } from '../../src/infrastructure/speech/elevenlabs-tts-synthesizer.js';
import { TtsSynthesizer } from '../../src/infrastructure/speech/tts-synthesizer.js';
import type { Env } from '../../src/config/env.js';

// Solo los campos que mira `buildSynthesizer`; el resto del Env no interviene.
function envWith(elevenLabsKey: string | undefined): Env {
  return {
    TTS_MODEL: 'tts-1',
    TTS_VOICE: 'alloy',
    ELEVENLABS_API_KEY: elevenLabsKey,
    ELEVENLABS_VOICE_ID: 'voz-de-prueba',
    ELEVENLABS_MODEL: 'eleven_multilingual_v2',
    ELEVENLABS_OUTPUT_FORMAT: 'opus_48000_64',
  } as Env;
}

describe('buildSynthesizer', () => {
  const openai = new OpenAI({ apiKey: 'llave-de-prueba' });

  it('usa ElevenLabs cuando hay llave', () => {
    expect(buildSynthesizer(envWith('llave-eleven'), openai)).toBeInstanceOf(
      ElevenLabsTtsSynthesizer,
    );
  });

  it('cae al TTS de OpenAI cuando falta la llave, en vez de dejar al bot mudo', () => {
    expect(buildSynthesizer(envWith(undefined), openai)).toBeInstanceOf(TtsSynthesizer);
  });
});
