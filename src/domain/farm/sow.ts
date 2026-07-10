import type { FarmId } from './farm.js';
import type { PenId } from './pen.js';

export type SowId = string;

export type SowStatus = 'reemplazo' | 'gestante' | 'lactante' | 'vacia' | 'descarte';

// Cría individual (cerda). La "chapeta" es el identificador físico que el
// operario usa en campo (arete), no un id técnico.
export interface Sow {
  readonly id: SowId;
  readonly farmId: FarmId;
  readonly chapeta: string;
  readonly entryDate?: Date;
  readonly initialWeightKg?: number;
  readonly initialCost?: number;
  readonly geneticLine?: string;
  readonly aplomos?: string;
  readonly numPezones?: number;
  readonly status: SowStatus;
  readonly currentPenId?: PenId;
}
