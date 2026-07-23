import { describe, expect, it } from 'vitest';
import type { LeadNotifier } from '../../src/application/ports/lead-notifier.js';
import type { Lead, LeadStore } from '../../src/application/ports/lead-store.js';
import { createLeadHandlers, type LeadHttpDeps } from '../../src/interfaces/http/leads-routes.js';
import { FakeClock } from '../application/fakes/fake-clock.js';

class RecordingStore implements LeadStore {
  saved: Lead | undefined;
  key: string | undefined;
  result: 'created' | 'duplicate' = 'created';

  async save(lead: Lead, idempotencyKey: string): Promise<'created' | 'duplicate'> {
    this.saved = lead;
    this.key = idempotencyKey;
    return this.result;
  }
}

class RecordingNotifier implements LeadNotifier {
  called = false;
  result = true;

  async notify(): Promise<boolean> {
    this.called = true;
    return this.result;
  }
}

function harness() {
  const clock = new FakeClock();
  const store = new RecordingStore();
  const notifier = new RecordingNotifier();
  const deps: LeadHttpDeps = { store, notifier, clock, corsAllowedOrigins: ['https://porcia.com.co'] };
  return { handlers: createLeadHandlers(deps), store, notifier };
}

const pilotLead = {
  type: 'pilot',
  name: 'Ana Pérez',
  whatsapp: '300 123 4567',
  interestedInManagement: true,
  consent: true,
};

describe('createLeadHandlers', () => {
  it('persiste y notifica un lead válido del piloto', async () => {
    const h = harness();
    const response = await h.handlers.submit({ body: pilotLead, ip: '127.0.0.1', idempotencyKey: 'key-12345678' });

    expect(response.status).toBe(201);
    expect(h.store.saved).toMatchObject(pilotLead);
    expect(h.store.key).toBe('key-12345678');
    expect(h.notifier.called).toBe(true);
  });

  it('rechaza consentimiento ausente sin persistir datos', async () => {
    const h = harness();
    const response = await h.handlers.submit({ body: { ...pilotLead, consent: false }, ip: '127.0.0.1', idempotencyKey: 'key-12345678' });

    expect(response.status).toBe(400);
    expect(h.store.saved).toBeUndefined();
  });

  it('no notifica dos veces cuando el envío es duplicado', async () => {
    const h = harness();
    h.store.result = 'duplicate';
    const response = await h.handlers.submit({ body: pilotLead, ip: '127.0.0.1', idempotencyKey: 'key-12345678' });

    expect(response.status).toBe(201);
    expect(h.notifier.called).toBe(false);
  });

  it('devuelve un error recuperable si falla la notificación', async () => {
    const h = harness();
    h.notifier.result = false;
    const response = await h.handlers.submit({ body: pilotLead, ip: '127.0.0.1', idempotencyKey: 'key-12345678' });

    expect(response.status).toBe(503);
  });
});
