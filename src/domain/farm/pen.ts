import type { FarmId } from './farm.js';

export type PenId = string;

export type PenKind = 'gestacion' | 'paridera' | 'precebo' | 'ceba';

export interface Pen {
  readonly id: PenId;
  readonly farmId: FarmId;
  readonly kind: PenKind;
  readonly capacity: number;
}
