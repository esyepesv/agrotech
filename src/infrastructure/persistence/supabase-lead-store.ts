import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lead, LeadStore } from '../../application/ports/lead-store.js';

const LEAD_TABLE = 'landing_lead';

/** Persistencia aislada para contactos de la landing; no toca el dominio de granjas. */
export class SupabaseLeadStore implements LeadStore {
  constructor(private readonly client: SupabaseClient) {}

  async save(lead: Lead, idempotencyKey: string): Promise<'created' | 'duplicate'> {
    const { data, error } = await this.client
      .from(LEAD_TABLE)
      .upsert(
        {
          lead_type: lead.type,
          name: lead.name,
          whatsapp: lead.whatsapp ?? null,
          email: lead.email ?? null,
          organization: lead.organization ?? null,
          farm_details: lead.farmDetails ?? null,
          interested_in_management: lead.interestedInManagement ?? false,
          message: lead.message ?? null,
          consented_at: new Date().toISOString(),
          source: 'porcia-web',
          idempotency_key: idempotencyKey,
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      )
      .select('id');
    if (error !== null) throw new Error('No fue posible guardar el contacto.');
    return data !== null && data.length > 0 ? 'created' : 'duplicate';
  }
}
