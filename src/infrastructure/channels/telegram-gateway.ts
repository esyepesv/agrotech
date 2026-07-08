import type {
  AudioClip,
  AudioReference,
  IncomingMessage,
} from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { ChannelError, ChannelGateway } from '../../application/ports/channel-gateway.js';
import { resilientFetch } from '../http/resilient-fetch.js';

interface TelegramFileResponse {
  readonly ok: boolean;
  readonly result?: { readonly file_path?: string };
}

/**
 * Adaptador del canal Telegram (Bot API). Descarga audio por file_id y
 * envía respuestas como nota de voz (sendVoice) o texto (sendMessage).
 * Traduce formatos del canal; no decide lógica de negocio.
 */
export class TelegramGateway implements ChannelGateway {
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
