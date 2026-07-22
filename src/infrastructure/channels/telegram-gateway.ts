import type {
  AudioClip,
  AudioReference,
  IncomingMessage,
} from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import type { InteractiveMessage } from '../../domain/message/reply-option.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { ChannelError, ChannelGateway } from '../../application/ports/channel-gateway.js';
import type { InteractiveGateway } from '../../application/ports/interactive-gateway.js';
import { resilientFetch } from '../http/resilient-fetch.js';

interface TelegramFileResponse {
  readonly ok: boolean;
  readonly result?: { readonly file_path?: string };
}

// callback_data de Telegram tope 64 bytes (spec 001 §4.1.1).
const CALLBACK_DATA_MAX_BYTES = 64;
const SHARE_CONTACT_BUTTON_LABEL = 'Compartir mi número';

/**
 * Adaptador del canal Telegram (Bot API). Descarga audio por file_id y
 * envía respuestas como nota de voz (sendVoice) o texto (sendMessage).
 * Traduce formatos del canal; no decide lógica de negocio.
 */
export class TelegramGateway implements ChannelGateway, InteractiveGateway {
  private readonly apiBase: string;
  private readonly fileBase: string;

  constructor(botToken: string) {
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
    this.fileBase = `https://api.telegram.org/file/bot${botToken}`;
  }

  async fetchAudio(ref: AudioReference): Promise<Result<AudioClip, ChannelError>> {
    try {
      const metaResponse = await resilientFetch(
        `${this.apiBase}/getFile?file_id=${encodeURIComponent(ref.mediaId)}`,
        { method: 'GET' },
      );
      const meta = (await metaResponse.json()) as TelegramFileResponse;
      const filePath = meta.result?.file_path;
      if (!meta.ok || filePath === undefined) {
        return err({ kind: 'fetch_failed', message: 'Telegram getFile sin file_path' });
      }

      const fileResponse = await resilientFetch(`${this.fileBase}/${filePath}`, { method: 'GET' });
      if (!fileResponse.ok) {
        return err({
          kind: 'fetch_failed',
          message: `descarga falló: HTTP ${String(fileResponse.status)}`,
        });
      }

      const data = new Uint8Array(await fileResponse.arrayBuffer());
      return ok({ data, mimeType: mimeFor(filePath) });
    } catch (error) {
      return err({ kind: 'fetch_failed', message: describe(error) });
    }
  }

  async send(message: OutgoingMessage): Promise<Result<void, ChannelError>> {
    try {
      return message.type === 'voice' && message.audio !== undefined
        ? await this.sendVoice(message, message.audio)
        : await this.sendText(message);
    } catch (error) {
      return err({ kind: 'send_failed', message: describe(error) });
    }
  }

  async indicateTyping(message: IncomingMessage): Promise<void> {
    try {
      await resilientFetch(`${this.apiBase}/sendChatAction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: message.channelUserId, action: 'typing' }),
      });
    } catch {
      // best-effort: la señal de escritura no debe romper el turno
    }
  }

  private async sendText(message: OutgoingMessage): Promise<Result<void, ChannelError>> {
    const response = await resilientFetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: message.channelUserId, text: message.text }),
    });
    return response.ok
      ? ok(undefined)
      : err({ kind: 'send_failed', message: `sendMessage: HTTP ${String(response.status)}` });
  }

  private async sendVoice(
    message: OutgoingMessage,
    audio: AudioClip,
  ): Promise<Result<void, ChannelError>> {
    const form = new FormData();
    form.append('chat_id', message.channelUserId);
    form.append('caption', message.text.slice(0, 1024));
    form.append('voice', new Blob([audio.data], { type: audio.mimeType }), 'respuesta.ogg');

    const response = await resilientFetch(`${this.apiBase}/sendVoice`, {
      method: 'POST',
      body: form,
    });
    return response.ok
      ? ok(undefined)
      : err({ kind: 'send_failed', message: `sendVoice: HTTP ${String(response.status)}` });
  }

  supportsInteractive(): boolean {
    return true;
  }

  async sendInteractive(message: InteractiveMessage): Promise<Result<void, ChannelError>> {
    if (message.options.length === 0) {
      return err({ kind: 'send_failed', message: 'sendInteractive sin opciones' });
    }

    // callback_data lo genera quien arma el ReplyOption (id namespaced,
    // spec 001 §4.1.1): un id que excede el límite de Telegram es un bug
    // del llamador, se rechaza explícito en vez de truncarlo en silencio
    // (truncar rompería el emparejamiento por id).
    const tooLong = message.options.find(
      (option) => byteLength(option.id) > CALLBACK_DATA_MAX_BYTES,
    );
    if (tooLong !== undefined) {
      return err({
        kind: 'send_failed',
        message: `callback_data excede ${String(CALLBACK_DATA_MAX_BYTES)} bytes: ${tooLong.id}`,
      });
    }

    try {
      const inlineKeyboard = message.options.map((option) => [
        { text: option.label, callback_data: option.id },
      ]);
      const response = await resilientFetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.channelUserId,
          text: message.body,
          reply_markup: { inline_keyboard: inlineKeyboard },
        }),
      });
      return response.ok
        ? ok(undefined)
        : err({ kind: 'send_failed', message: `sendMessage: HTTP ${String(response.status)}` });
    } catch (error) {
      return err({ kind: 'send_failed', message: describe(error) });
    }
  }

  /** Retira el spinner de carga de un callback_query (API `answerCallbackQuery`,
   * spec 001 §4.1.1, higiene de teclados). Best-effort: nunca rompe el turno. */
  async answerCallback(callbackQueryId: string): Promise<void> {
    try {
      await resilientFetch(`${this.apiBase}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    } catch {
      // best-effort: quitar el spinner nunca debe romper el turno
    }
  }

  /** Edita `reply_markup` del mensaje a vacío ("clearKeyboard") para que un
   * botón ya respondido no quede re-pulsable. Best-effort. */
  async clearOptions(chatId: string, messageId: number): Promise<void> {
    try {
      await resilientFetch(`${this.apiBase}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        }),
      });
    } catch {
      // best-effort: la higiene de teclado nunca debe romper el turno
    }
  }

  /**
   * Pide el celular con el botón nativo "compartir contacto" (spec 001
   * §4.1.2): a diferencia de WhatsApp, el chat_id de Telegram no es un
   * teléfono, así que aquí sí hace falta pedirlo explícitamente. Es un
   * *reply keyboard* (no inline): al tocarlo, Telegram manda un update con
   * `message.contact` — quien parsea el webhook debe validar que
   * `contact.user_id` sea el remitente antes de dar el teléfono por
   * verificado (ver `isSelfSharedContact`, domain/otp/telegram-contact.ts).
   */
  async requestContact(channelUserId: string, body: string): Promise<Result<void, ChannelError>> {
    try {
      const response = await resilientFetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: channelUserId,
          text: body,
          reply_markup: {
            keyboard: [[{ text: SHARE_CONTACT_BUTTON_LABEL, request_contact: true }]],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        }),
      });
      return response.ok
        ? ok(undefined)
        : err({
            kind: 'send_failed',
            message: `sendMessage (requestContact): HTTP ${String(response.status)}`,
          });
    } catch (error) {
      return err({ kind: 'send_failed', message: describe(error) });
    }
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function mimeFor(filePath: string): string {
  if (filePath.endsWith('.oga') || filePath.endsWith('.ogg')) return 'audio/ogg';
  if (filePath.endsWith('.mp3')) return 'audio/mpeg';
  if (filePath.endsWith('.m4a')) return 'audio/mp4';
  if (filePath.endsWith('.wav')) return 'audio/wav';
  return 'audio/ogg';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en Telegram';
}
