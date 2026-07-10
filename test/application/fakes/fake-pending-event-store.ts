import type { OperatorId } from '../../../src/domain/farm/operator.js';
import type { PendingDraft } from '../../../src/domain/farm/pending-draft.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';
import type { Clock } from '../../../src/application/ports/clock.js';
import type { PendingEventStore } from '../../../src/application/ports/pending-event-store.js';
import type { PersistenceError } from '../../../src/application/ports/persistence-error.js';

interface PendingEntry {
  readonly pending: PendingDraft;
  readonly expiresAt: Date;
}

export class FakePendingEventStore implements PendingEventStore {
  readonly store = new Map<OperatorId, PendingEntry>();

  // Recibe un Clock para respetar el TTL en pruebas deterministas (usar
  // FakeClock, sin depender del reloj real).
  constructor(private readonly clock: Clock) {}

  async savePending(
    operatorId: OperatorId,
    pending: PendingDraft,
    ttlSeconds: number,
  ): Promise<Result<void, PersistenceError>> {
    const expiresAt = new Date(this.clock.now().getTime() + ttlSeconds * 1000);
    this.store.set(operatorId, { pending, expiresAt });
    return ok(undefined);
  }

  async takePending(operatorId: OperatorId): Promise<PendingDraft | null> {
    const entry = this.store.get(operatorId);
    this.store.delete(operatorId);
    if (!entry || entry.expiresAt.getTime() <= this.clock.now().getTime()) {
      return null;
    }
    return entry.pending;
  }

  async hasPending(operatorId: OperatorId): Promise<boolean> {
    const entry = this.store.get(operatorId);
    if (!entry) {
      return false;
    }
    if (entry.expiresAt.getTime() <= this.clock.now().getTime()) {
      this.store.delete(operatorId);
      return false;
    }
    return true;
  }
}
