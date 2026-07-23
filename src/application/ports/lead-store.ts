export type LeadType = 'pilot' | 'partner';

export interface Lead {
  readonly type: LeadType;
  readonly name: string;
  readonly whatsapp?: string;
  readonly email?: string;
  readonly organization?: string;
  readonly farmDetails?: string;
  readonly interestedInManagement?: boolean;
  readonly message?: string;
  readonly consent: boolean;
}

export interface LeadStore {
  save(lead: Lead, idempotencyKey: string): Promise<'created' | 'duplicate'>;
}
