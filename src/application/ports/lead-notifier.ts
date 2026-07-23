import type { Lead } from './lead-store.js';

export interface LeadNotifier {
  notify(lead: Lead): Promise<boolean>;
}
