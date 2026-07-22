import { describe, expect, it } from 'vitest';
import { channelIdentityValue } from '../../src/domain/message/channel-identity.js';

describe('channelIdentityValue', () => {
  it('normaliza el wa_id de WhatsApp a E.164 para que cuadre con el hash del celular', () => {
    expect(channelIdentityValue('whatsapp', '573001234567')).toBe('+573001234567');
    expect(channelIdentityValue('whatsapp', '+573001234567')).toBe('+573001234567');
  });

  it('deja el id de Telegram en un espacio propio: nunca puede colisionar con un celular', () => {
    expect(channelIdentityValue('telegram', '123456789')).toBe('tg:123456789');
  });

  it('devuelve el id crudo si no es un celular colombiano reconocible', () => {
    expect(channelIdentityValue('whatsapp', '12025550123')).toBe('12025550123');
  });
});
