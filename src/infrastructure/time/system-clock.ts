import type { Clock } from '../../application/ports/clock.js';

/**
 * Reloj real del sistema. Existe como adaptador (y no Date directo en los
 * casos de uso) para que KPIs y TTLs sean deterministas en tests (FakeClock).
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
