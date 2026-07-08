import type {
  AudioClip,
  AudioReference,
  IncomingMessage,
} from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { ChannelError, ChannelGateway } from '../../application/ports/channel-gateway.js';
import { resilientFetch } from '../http/resilient-fetch.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

interface MediaUrlResponse {
  readonly url?: string;
  readonly mime_type?: string;
}

interface UploadedMediaResponse {
  readonly id?: string;
}

export interface WhatsAppConfig {
  readonly token: string;
  readonly phoneNumberId: string;
}

/**
 * Adaptador del canal WhatsApp (Cloud API de Meta). La descarga de media
 * es en dos pasos: resolver la URL por mediaId y luego bajar el binario
 * (autenticado). El envío de audio requiere subir el media primero.
 */
export class WhatsAppGateway implements ChannelGateway {
  constructor(private readonly config: WhatsAppConfig) {}

  private get authHeader(): Record<string, string> {
    return { authorization: `Bearer ${this.config.token}` };
  }

  async fetchAudio(ref: AudioReference): Promise<Result<AudioClip, ChannelError>> {
    try {
      const urlResponse = await resilientFetch(`${GRAPH_BASE}/${ref.mediaId}`, {
        method: 'GET',
        headers: this.authHeader,
      });
      const meta = (await urlResponse.json()) as MediaUrlResponse;
      if (meta.url === undefined) {
        return err({ kind: 'fetch_failed', message: 'WhatsApp media sin URL' });
      }

      const binary = await resilientFetch(meta.url, { method: 'GET', headers: this.authHeader });
      if (!binary.ok) {
        return err({
          kind: 'fetch_failed',
          message: `descarga falló: HTTP ${String(binary.status)}`,
        });
      }

      const data = new Uint8Array(await binary.arrayBuffer());
      return ok({ data, mimeType: meta.mime_type ?? 'audio/ogg' });
    } catch (error) {
      return err({ kind: 'fetch_failed', message: describe(error) });
    }
  }

  async send(message: OutgoingMessage): Promise<Result<void, ChannelError>> {
    try {
      if (message.type === 'voice' && message.audio !== undefined) {
        const uploaded = await this.uploadAudio(message.audio);
        if (!uploaded.ok) {
          return uploaded;
        }
        return await this.sendMessage(message.channelUserId, {
          type: 'audio',
          audio: { id: uploaded.value },
        });
      }
      return await this.sendMessage(message.channelUserId, {
        type: 'text',
        text: { body: message.text },
      });
    } catch (error) {
      return err({ kind: 'send_failed', message: describe(error) });
    }
  }

  async indicateTyping(message: IncomingMessage): Promise<void> {
    try {
      await resilientFetch(`${GRAPH_BASE}/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { ...this.authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: message.messageId,
          typing_indicator: { type: 'text' },
        }),
      });
    } catch {
      // best-effort: la señal de escritura no debe romper el turno
    }
  }

  private async uploadAudio(audio: AudioClip): Promise<Result<string, ChannelError>> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', audio.mimeType);
    form.append('file', new Blob([audio.data], { type: audio.mimeType }), 'respuesta.ogg');

    const response = await resilientFetch(`${GRAPH_BASE}/${this.config.phoneNumberId}/media`, {
      method: 'POST',
      headers: this.authHeader,
      body: form,
    });
    const body = (await response.json()) as UploadedMediaResponse;
    if (!response.ok || body.id === undefined) {
      return err({ kind: 'send_failed', message: 'fallo al subir audio a WhatsApp' });
    }
    return ok(body.id);
  }

  private async sendMessage(
    to: string,
    payload: Record<string, unknown>,
  ): Promise<Result<void, ChannelError>> {
    const response = await resilientFetch(`${GRAPH_BASE}/${this.config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { ...this.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
    });
    return response.ok
      ? ok(undefined)
      : err({ kind: 'send_failed', message: `messages: HTTP ${String(response.status)}` });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en WhatsApp';
}
