import { describe, expect, it } from 'vitest';
import { parseWhatsAppMessage } from '../../src/interfaces/http/whatsapp-webhook.js';

function payloadWith(message: Record<string, unknown>): unknown {
  return {
    entry: [{ changes: [{ value: { messages: [message] } }] }],
  };
}

describe('parseWhatsAppMessage', () => {
  it('traduce un mensaje de texto a IncomingMessage de tipo text', () => {
    const message = parseWhatsAppMessage(
      payloadWith({
        id: 'wamid.1',
        from: '573001112233',
        type: 'text',
        text: { body: '¿qué es condición corporal?' },
      }),
    );

    expect(message).toMatchObject({
      channel: 'whatsapp',
      channelUserId: '573001112233',
      messageId: 'wamid.1',
      type: 'text',
      text: '¿qué es condición corporal?',
    });
  });

  it('traduce un mensaje de audio a IncomingMessage de tipo voice con audioRef', () => {
    const message = parseWhatsAppMessage(
      payloadWith({
        id: 'wamid.2',
        from: '573004445566',
        type: 'audio',
        audio: { id: 'media-abc' },
      }),
    );

    expect(message).toMatchObject({
      channel: 'whatsapp',
      channelUserId: '573004445566',
      messageId: 'wamid.2',
      type: 'voice',
      audioRef: { channel: 'whatsapp', mediaId: 'media-abc' },
    });
  });

  it('payload inválido (estructura Meta no reconocida) devuelve undefined', () => {
    expect(parseWhatsAppMessage({ foo: 'bar' })).toBeUndefined();
    expect(parseWhatsAppMessage(null)).toBeUndefined();
    expect(parseWhatsAppMessage('not an object')).toBeUndefined();
  });

  it('entry sin messages (p. ej. evento de estado) devuelve undefined', () => {
    expect(parseWhatsAppMessage({ entry: [{ changes: [{ value: {} }] }] })).toBeUndefined();
  });

  it('mensaje de texto vacío devuelve undefined', () => {
    const message = parseWhatsAppMessage(
      payloadWith({
        id: 'wamid.3',
        from: '573001112233',
        type: 'text',
        text: { body: '   ' },
      }),
    );
    expect(message).toBeUndefined();
  });

  it('tipo de mensaje no soportado (p. ej. sticker) devuelve undefined', () => {
    const message = parseWhatsAppMessage(
      payloadWith({ id: 'wamid.4', from: '573001112233', type: 'sticker' }),
    );
    expect(message).toBeUndefined();
  });
});
