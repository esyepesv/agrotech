import { describe, expect, it } from 'vitest';
import { parsePendingDraft } from '../../src/infrastructure/persistence/supabase-pending-event-store.js';

describe('parsePendingDraft', () => {
  it('restaura el borrador conversacional de registro guardado en Supabase', () => {
    const draft = {
      kind: 'register_farm_and_user' as const,
      partial: { role: 'administrador_dueno' as const, failedAttempts: 0 },
      step: 'farmName',
    };

    expect(parsePendingDraft(draft)).toEqual(draft);
  });
});
