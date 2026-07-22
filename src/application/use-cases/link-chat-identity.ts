import { channelIdentityValue } from '../../domain/message/channel-identity.js';
import type { Channel } from '../../domain/message/incoming-message.js';
import type { Clock } from '../ports/clock.js';
import type { FarmRepository, OperatorWithFarm } from '../ports/farm-repository.js';

export interface LinkChatIdentityDeps {
  readonly farmRepository: FarmRepository;
  readonly hashUserId: (raw: string) => string;
  readonly clock: Clock;
}

export class LinkChatIdentity {
  constructor(private readonly deps: LinkChatIdentityDeps) {}

  async tryLink(
    channel: Channel,
    channelUserId: string,
    phone: string,
  ): Promise<OperatorWithFarm | null> {
    const user = await this.deps.farmRepository.findUserByPhoneHash(this.deps.hashUserId(phone));
    if (user === null) return null;
    const identityHash = this.deps.hashUserId(channelIdentityValue(channel, channelUserId));
    const linked = await this.deps.farmRepository.attachChatIdentity(
      user.id,
      channel === 'whatsapp'
        ? { channelUserHash: identityHash, phoneVerifiedAt: this.deps.clock.now() }
        : { telegramUserHash: identityHash, phoneVerifiedAt: this.deps.clock.now() },
    );
    if (!linked.ok) return null;
    return (
      (await this.deps.farmRepository.findFarmsByUser(user.id)).find(
        (membership) => membership.operator.status === 'activo',
      ) ?? null
    );
  }
}
