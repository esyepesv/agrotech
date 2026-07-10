import type { Clock } from '../../../src/application/ports/clock.js';

export class FakeClock implements Clock {
  nowValue: Date;

  constructor(initial: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.nowValue = initial;
  }

  now(): Date {
    return this.nowValue;
  }

  advanceSeconds(seconds: number): void {
    this.nowValue = new Date(this.nowValue.getTime() + seconds * 1000);
  }
}
