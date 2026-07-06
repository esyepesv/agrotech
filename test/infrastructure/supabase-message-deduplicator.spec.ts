import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from '../../src/shared/logger.js';
import { SupabaseMessageDeduplicator } from '../../src/infrastructure/persistence/supabase-message-deduplicator.js';

interface FakeInsertResult {
  readonly error: { code?: string; message: string } | null;
}

function fakeClient(result: FakeInsertResult): SupabaseClient {
  return {
    from: () => ({
      insert: () => Promise.resolve(result),
    }),
  } as unknown as SupabaseClient;
}

function fakeLogger(): Logger {
  return { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() } as unknown as Logger;
}

describe('SupabaseMessageDeduplicator', () => {
  it('primera vez (insert sin error) → firstSight true', async () => {
    const dedup = new SupabaseMessageDeduplicator(fakeClient({ error: null }), fakeLogger());

    await expect(dedup.firstSight('msg-1')).resolves.toBe(true);
  });

  it('mensaje ya visto (violación de PK única 23505) → firstSight false', async () => {
    const dedup = new SupabaseMessageDeduplicator(
      fakeClient({
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
      fakeLogger(),
    );

    await expect(dedup.firstSight('msg-1')).resolves.toBe(false);
  });

  it('otro error (p. ej. migración 0002 pendiente, tabla inexistente) → fail-open, firstSight true y advierte', async () => {
    const logger = fakeLogger();
    const dedup = new SupabaseMessageDeduplicator(
      fakeClient({ error: { message: 'relation "processed_message" does not exist' } }),
      logger,
    );

    await expect(dedup.firstSight('msg-1')).resolves.toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
