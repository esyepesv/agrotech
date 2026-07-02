import type { IncomingMessage } from '../../domain/message/incoming-message.js';
import type { Container } from '../../config/container.js';
import type { Logger } from '../../shared/logger.js';
import { SeenMessages } from './dedup.js';

/**
 * Puerto de entrada para los webhooks: reciben el mensaje ya traducido y lo
 * despachan hacia el caso de uso. Existe para que el controller HTTP no
 * conozca el container ni el caso de uso directamente (sección 14).
 */
export interface WebhookDispatcher {
  dispatch(message: IncomingMessage): void;
}

/**
 * Despacha mensajes entrantes al caso de uso sin bloquear la respuesta HTTP
 * (fire-and-forget): el webhook responde 200 de inmediato y esto corre en
 * background. Deduplica por messageId (los proveedores reintentan) y nunca
 * propaga errores al proveedor — solo los loguea (sección 14).
 */
export class AnswerQueryDispatcher implements WebhookDispatcher {
  private readonly seenMessages = new SeenMessages();

  constructor(
    private readonly container: Container,
    private readonly logger: Logger,
  ) {}

  dispatch(message: IncomingMessage): void {
    if (!this.seenMessages.firstSight(message.messageId)) {
      this.logger.debug({ messageId: message.messageId }, 'mensaje duplicado ignorado');
      return;
    }

    const gateway = this.container.resolveGateway(message.channel);
    void this.container.answerQuery.handle(message, gateway).catch((error: unknown) => {
      this.logger.error(
        { err: error, messageId: message.messageId, channel: message.channel },
        'fallo al procesar mensaje entrante',
      );
    });
  }
}
