import type { InteractiveMessage } from '../../../src/domain/message/reply-option.js';
import type { ChannelError } from '../../../src/application/ports/channel-gateway.js';
import type { InteractiveGateway } from '../../../src/application/ports/interactive-gateway.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';

export class FakeInteractiveGateway implements InteractiveGateway {
  readonly sent: InteractiveMessage[] = [];
  readonly answeredCallbacks: string[] = [];
  readonly clearedOptions: { chatId: string; messageId: number }[] = [];
  readonly contactRequests: { channelUserId: string; body: string }[] = [];

  constructor(
    private readonly supports = true,
    private readonly sendResult: Result<void, ChannelError> = ok(undefined),
  ) {}

  supportsInteractive(): boolean {
    return this.supports;
  }

  async sendInteractive(message: InteractiveMessage): Promise<Result<void, ChannelError>> {
    this.sent.push(message);
    return this.sendResult;
  }

  async answerCallback(callbackQueryId: string): Promise<void> {
    this.answeredCallbacks.push(callbackQueryId);
  }

  async clearOptions(chatId: string, messageId: number): Promise<void> {
    this.clearedOptions.push({ chatId, messageId });
  }

  async requestContact(channelUserId: string, body: string): Promise<Result<void, ChannelError>> {
    this.contactRequests.push({ channelUserId, body });
    return this.sendResult;
  }
}
