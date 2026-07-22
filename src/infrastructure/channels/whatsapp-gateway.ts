import type {
  AudioClip,
  AudioReference,
  IncomingMessage,
} from '../../domain/message/incoming-message.js';
import type { OutgoingMessage } from '../../domain/message/outgoing-message.js';
import type { InteractiveMessage, ReplyOption } from '../../domain/message/reply-option.js';
import { err, ok, type Result } from '../../domain/shared/result.js';
import type { ChannelError, ChannelGateway } from '../../application/ports/channel-gateway.js';
import type { InteractiveGateway } from '../../application/ports/interactive-gateway.js';
import { resilientFetch } from '../http/resilient-fetch.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// Límites de la Cloud API para mensajes interactivos (spec 001 §4.1.1).
const MAX_BUTTONS = 3;
const BUTTON_TITLE_MAX = 20;
const BUTTON_ID_MAX = 256;
const LIST_ROW_TITLE_MAX = 24;
const LIST_MAX_ROWS = 10;
const BODY_MAX = 1024;
const LIST_CTA_LABEL = 'Ver opciones';

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
export class WhatsAppGateway implements ChannelGateway, InteractiveGateway {
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

  supportsInteractive(): boolean {
    return true;
  }

  async sendInteractive(message: InteractiveMessage): Promise<Result<void, ChannelError>> {
    if (message.options.length === 0) {
      return err({ kind: 'send_failed', message: 'sendInteractive sin opciones' });
    }

    // El id lo genera quien arma el ReplyOption (namespaced reg:campo:valor,
    // spec 001 §4.1.1): truncarlo rompería el emparejamiento por id, así que
    // se rechaza en vez de recortarlo.
    const idTooLong = message.options.find((option) => option.id.length > BUTTON_ID_MAX);
    if (idTooLong !== undefined) {
      return err({
        kind: 'send_failed',
        message: `reply.id excede ${String(BUTTON_ID_MAX)} caracteres: ${idTooLong.id}`,
      });
    }

    const body = truncateChars(message.body, BODY_MAX, 'body de interactive de WhatsApp');

    try {
      if (message.layout === 'buttons') {
        if (message.options.length > MAX_BUTTONS) {
          // Fuera del límite duro de la Cloud API: degradación (no envío
          // parcial) queda a cargo de quien llama, vía renderNumberedFallback.
          return err({
            kind: 'send_failed',
            message: `reply buttons admite máx ${String(MAX_BUTTONS)} opciones (llegaron ${String(message.options.length)})`,
          });
        }
        return await this.sendMessage(message.channelUserId, {
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: body },
            action: { buttons: message.options.map((option) => this.toButton(option)) },
          },
        });
      }

      if (message.options.length > LIST_MAX_ROWS) {
        return err({
          kind: 'send_failed',
          message: `list message admite máx ${String(LIST_MAX_ROWS)} filas (llegaron ${String(message.options.length)})`,
        });
      }
      return await this.sendMessage(message.channelUserId, {
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: LIST_CTA_LABEL,
            sections: [{ rows: message.options.map((option) => this.toRow(option)) }],
          },
        },
      });
    } catch (error) {
      return err({ kind: 'send_failed', message: describe(error) });
    }
  }

  private toButton(option: ReplyOption): {
    type: 'reply';
    reply: { id: string; title: string };
  } {
    return {
      type: 'reply',
      reply: {
        id: option.id,
        title: truncateChars(option.label, BUTTON_TITLE_MAX, 'título de botón'),
      },
    };
  }

  private toRow(option: ReplyOption): { id: string; title: string } {
    return {
      id: option.id,
      title: truncateChars(option.label, LIST_ROW_TITLE_MAX, 'título de fila de lista'),
    };
  }
}

/** Trunca por code point (no por code unit) para no partir un emoji/tilde a
 * la mitad, y avisa por qué se degradó el contenido (spec 001 §5: "fallo al
 * enviar el mensaje interactivo... etiqueta muy larga" se loguea). */
function truncateChars(text: string, max: number, context: string): string {
  const chars = [...text];
  if (chars.length <= max) {
    return text;
  }
  console.warn(
    `WhatsAppGateway: truncando ${context} de ${String(chars.length)} a ${String(max)} caracteres`,
  );
  return chars.slice(0, max).join('').trimEnd();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido en WhatsApp';
}
