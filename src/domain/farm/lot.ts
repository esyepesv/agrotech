import type { FarmId } from './farm.js';
import type { PenId } from './pen.js';

export type LotId = string;

export type LotStage = 'precebo' | 'ceba';

export type LotStatus = 'activo' | 'cerrado';

// Grupo de animales (lote de pre-cebo/ceba), a diferencia de la cría
// individual (Sow) que se sigue por chapeta.
export interface Lot {
  readonly id: LotId;
  readonly farmId: FarmId;
  readonly stage: LotStage;
  readonly startDate?: Date;
  readonly animalCount: number;
  readonly penId?: PenId;
  readonly avgInitialWeightKg?: number;
  readonly avgFinalWeightKg?: number;
  readonly status: LotStatus;
}
