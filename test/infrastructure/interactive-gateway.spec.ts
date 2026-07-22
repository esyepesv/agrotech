import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppGateway } from '../../src/infrastructure/channels/whatsapp-gateway.js';
import { TelegramGateway } from '../../src/infrastructure/channels/telegram-gateway.js';
import {
  matchOption,
  optionId,
  parseOptionId,
  renderNumberedFallback,
  type ReplyOption,
} from '../../src/domain/message/reply-option.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function optionsOf(...labels: string[]): ReplyOption[] {
  return labels.map((label, index) => ({ id: optionId('campo', `v${String(index)}`), label }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WhatsAppGateway.sendInteractive', () => {
  it('layout buttons: arma interactive.type=button con máx 3 opciones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });

    const result = await gateway.sendInteractive({
      channel: 'whatsapp',
      channelUserId: '+573001234567',
      body: '¿Eres dueño o trabajador?',
      layout: 'buttons',
      options: optionsOf('Soy dueño', 'Soy trabajador'),
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(call[1].body) as {
      type: string;
      interactive: {
        type: string;
        action: { buttons: { reply: { id: string; title: string } }[] };
      };
    };
    expect(payload.type).toBe('interactive');
    expect(payload.interactive.type).toBe('button');
    expect(payload.interactive.action.buttons).toHaveLength(2);
    expect(payload.interactive.action.buttons[0]?.reply.title).toBe('Soy dueño');
  });

  it('rechaza más de 3 botones sin llamar a fetch (degradación queda del lado del llamador)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });

    const result = await gateway.sendInteractive({
      channel: 'whatsapp',
      channelUserId: '+573001234567',
      body: 'elige uno',
      layout: 'buttons',
      options: optionsOf('uno', 'dos', 'tres', 'cuatro'),
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('trunca etiquetas de botón a 20 caracteres y avisa', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });

    const longLabel = 'Una etiqueta de botón bastante más larga que veinte caracteres';
    await gateway.sendInteractive({
      channel: 'whatsapp',
      channelUserId: '+573001234567',
      body: 'body',
      layout: 'buttons',
      options: [{ id: optionId('campo', 'v0'), label: longLabel }],
    });

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(call[1].body) as {
      interactive: { action: { buttons: { reply: { title: string } }[] } };
    };
    const title = payload.interactive.action.buttons[0]?.reply.title ?? '';
    expect(title.length).toBeLessThanOrEqual(20);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('rechaza reply.id que excede 256 caracteres sin truncarlo', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });

    const result = await gateway.sendInteractive({
      channel: 'whatsapp',
      channelUserId: '+573001234567',
      body: 'body',
      layout: 'buttons',
      options: [{ id: 'x'.repeat(300), label: 'ok' }],
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('layout list: arma interactive.type=list con filas truncadas a 24 caracteres, máx 10', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });

    const result = await gateway.sendInteractive({
      channel: 'whatsapp',
      channelUserId: '+573001234567',
      body: 'elige tu finca',
      layout: 'list',
      options: optionsOf('Finca La Esperanza, vereda El Roble, muy larga', 'Finca 2'),
    });

    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(call[1].body) as {
      interactive: { type: string; action: { sections: { rows: { title: string }[] }[] } };
    };
    expect(payload.interactive.type).toBe('list');
    const rows = payload.interactive.action.sections[0]?.rows ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.title.length).toBeLessThanOrEqual(24);
  });

  it('rechaza más de 10 filas en list', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });

    const labels = Array.from({ length: 11 }, (_, i) => `Finca ${String(i)}`);
    const result = await gateway.sendInteractive({
      channel: 'whatsapp',
      channelUserId: '+573001234567',
      body: 'elige tu finca',
      layout: 'list',
      options: optionsOf(...labels),
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('trunca el body si excede 1024 caracteres', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });

    await gateway.sendInteractive({
      channel: 'whatsapp',
      channelUserId: '+573001234567',
      body: 'x'.repeat(2000),
      layout: 'buttons',
      options: optionsOf('sí'),
    });

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(call[1].body) as { interactive: { body: { text: string } } };
    expect(payload.interactive.body.text.length).toBeLessThanOrEqual(1024);
  });

  it('sendInteractive sin opciones es un error explícito', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });

    const result = await gateway.sendInteractive({
      channel: 'whatsapp',
      channelUserId: '+573001234567',
      body: 'body',
      layout: 'buttons',
      options: [],
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('supportsInteractive() es true', () => {
    const gateway = new WhatsAppGateway({ token: 't', phoneNumberId: '123' });
    expect(gateway.supportsInteractive()).toBe(true);
  });
});

describe('TelegramGateway.sendInteractive', () => {
  it('arma reply_markup.inline_keyboard con una fila por opción', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new TelegramGateway('bot-token');

    const result = await gateway.sendInteractive({
      channel: 'telegram',
      channelUserId: '999',
      body: '¿Eres dueño o trabajador?',
      layout: 'buttons',
      options: optionsOf('Soy dueño', 'Soy trabajador'),
    });

    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(call[1].body) as {
      reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] };
    };
    expect(payload.reply_markup.inline_keyboard).toHaveLength(2);
    expect(payload.reply_markup.inline_keyboard[0]).toHaveLength(1);
    expect(payload.reply_markup.inline_keyboard[0]?.[0]?.text).toBe('Soy dueño');
    expect(payload.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe(
      optionId('campo', 'v0'),
    );
  });

  it('devuelve error explícito si un callback_data excede 64 bytes (no lo trunca)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new TelegramGateway('bot-token');

    const result = await gateway.sendInteractive({
      channel: 'telegram',
      channelUserId: '999',
      body: 'body',
      layout: 'buttons',
      options: [{ id: 'a'.repeat(70), label: 'ok' }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('64 bytes');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('supportsInteractive() es true', () => {
    const gateway = new TelegramGateway('bot-token');
    expect(gateway.supportsInteractive()).toBe(true);
  });

  it('answerCallback llama a answerCallbackQuery best-effort', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new TelegramGateway('bot-token');

    await gateway.answerCallback('cbq-1');

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(call[0]).toContain('answerCallbackQuery');
    const payload = JSON.parse(call[1].body) as { callback_query_id: string };
    expect(payload.callback_query_id).toBe('cbq-1');
  });

  it('clearOptions edita reply_markup a inline_keyboard vacío', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new TelegramGateway('bot-token');

    await gateway.clearOptions('chat-1', 42);

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(call[0]).toContain('editMessageReplyMarkup');
    const payload = JSON.parse(call[1].body) as {
      chat_id: string;
      message_id: number;
      reply_markup: { inline_keyboard: unknown[] };
    };
    expect(payload.chat_id).toBe('chat-1');
    expect(payload.message_id).toBe(42);
    expect(payload.reply_markup.inline_keyboard).toEqual([]);
  });

  it('requestContact arma un reply keyboard (no inline) con request_contact: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new TelegramGateway('bot-token');

    const result = await gateway.requestContact?.('999', 'Comparte tu número');
    expect(result?.ok).toBe(true);

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(call[1].body) as {
      chat_id: string;
      text: string;
      reply_markup: {
        keyboard: { text: string; request_contact: boolean }[][];
        one_time_keyboard: boolean;
        resize_keyboard: boolean;
      };
    };
    expect(payload.chat_id).toBe('999');
    expect(payload.text).toBe('Comparte tu número');
    expect(payload.reply_markup.keyboard).toHaveLength(1);
    expect(payload.reply_markup.keyboard[0]).toHaveLength(1);
    expect(payload.reply_markup.keyboard[0]?.[0]?.request_contact).toBe(true);
    expect(payload.reply_markup.one_time_keyboard).toBe(true);
    expect(payload.reply_markup.resize_keyboard).toBe(true);
    // No debe llevar inline_keyboard: es un reply keyboard, no inline.
    expect(payload.reply_markup).not.toHaveProperty('inline_keyboard');
  });
});

describe('optionId / parseOptionId', () => {
  it('optionId construye el id namespaced reg:<campo>:<valor>', () => {
    expect(optionId('tipo_persona', 'natural')).toBe('reg:tipo_persona:natural');
  });

  it('parseOptionId es el inverso de optionId', () => {
    expect(parseOptionId('reg:tipo_persona:natural')).toEqual({
      field: 'tipo_persona',
      value: 'natural',
    });
  });

  it('parseOptionId devuelve undefined para texto libre sin el formato', () => {
    expect(parseOptionId('natural')).toBeUndefined();
    expect(parseOptionId('reg:solocampo')).toBeUndefined();
    expect(parseOptionId('otro:campo:valor')).toBeUndefined();
  });
});

describe('renderNumberedFallback', () => {
  it('numera las opciones en el cuerpo', () => {
    const rendered = renderNumberedFallback('¿Eres dueño o trabajador?', [
      { id: optionId('rol', 'dueno'), label: 'Soy dueño' },
      { id: optionId('rol', 'trabajador'), label: 'Soy trabajador' },
    ]);
    expect(rendered).toContain('¿Eres dueño o trabajador?');
    expect(rendered).toContain('1. Soy dueño');
    expect(rendered).toContain('2. Soy trabajador');
  });
});

describe('matchOption', () => {
  const options: ReplyOption[] = [
    { id: optionId('tipo_persona', 'natural'), label: 'Natural' },
    { id: optionId('tipo_persona', 'juridica'), label: 'Jurídica' },
  ];

  it('empareja por id exacto (pulsación real de botón/fila)', () => {
    expect(matchOption(optionId('tipo_persona', 'juridica'), options)).toBe(options[1]);
  });

  it('empareja por número directo', () => {
    expect(matchOption('1', options)).toBe(options[0]);
    expect(matchOption('2', options)).toBe(options[1]);
  });

  it('empareja por ordinal hablado ("la primera")', () => {
    expect(matchOption('la primera', options)).toBe(options[0]);
  });

  it('empareja por etiqueta normalizada (sin tildes/mayúsculas)', () => {
    expect(matchOption('natural', options)).toBe(options[0]);
    expect(matchOption('JURIDICA', options)).toBe(options[1]);
  });

  it('empareja "SÍ" con una etiqueta "Sí, confirmar" por su primera palabra', () => {
    const confirmOptions: ReplyOption[] = [
      { id: optionId('confirmacion', 'si'), label: 'Sí, confirmar' },
      { id: optionId('confirmacion', 'no'), label: 'Cancelar' },
    ];
    expect(matchOption('SÍ', confirmOptions)).toBe(confirmOptions[0]);
  });

  it('devuelve undefined si no hay match', () => {
    expect(matchOption('algo que no calza', options)).toBeUndefined();
    expect(matchOption('', options)).toBeUndefined();
  });
});
