import { describe, expect, it } from 'vitest';
import { parseTelegramUpdate } from '../../src/interfaces/http/telegram-webhook.js';

describe('parseTelegramUpdate', () => {
  it('traduce un update de texto a IncomingMessage de tipo text', () => {
    const message = parseTelegramUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 123 },
        text: '¿cómo alimento una hembra lactante?',
      },
    });

    expect(message).toMatchObject({
      channel: 'telegram',
      channelUserId: '123',
      type: 'text',
      text: '¿cómo alimento una hembra lactante?',
    });
    expect(message?.messageId).toBe('tg:1');
  });

  it('traduce un update de voz a IncomingMessage de tipo voice con audioRef', () => {
    const message = parseTelegramUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        chat: { id: 456 },
        voice: { file_id: 'file-abc' },
      },
    });

    expect(message).toMatchObject({
      channel: 'telegram',
      channelUserId: '456',
      type: 'voice',
      audioRef: { channel: 'telegram', mediaId: 'file-abc' },
    });
  });

  it('un audio (no voice) también se trata como nota de voz', () => {
    const message = parseTelegramUpdate({
      update_id: 3,
      message: {
        message_id: 12,
        chat: { id: 789 },
        audio: { file_id: 'file-xyz' },
      },
    });

    expect(message?.audioRef).toEqual({ channel: 'telegram', mediaId: 'file-xyz' });
  });

  it('payload inválido (sin schema esperado) devuelve undefined', () => {
    expect(parseTelegramUpdate({ foo: 'bar' })).toBeUndefined();
    expect(parseTelegramUpdate(null)).toBeUndefined();
    expect(parseTelegramUpdate('not an object')).toBeUndefined();
  });

  it('update sin message (p. ej. edited_message no soportado) devuelve undefined', () => {
    expect(parseTelegramUpdate({ update_id: 4 })).toBeUndefined();
  });

  it('mensaje de texto vacío devuelve undefined', () => {
    const message = parseTelegramUpdate({
      update_id: 5,
      message: { message_id: 13, chat: { id: 1 }, text: '   ' },
    });
    expect(message).toBeUndefined();
  });
});
