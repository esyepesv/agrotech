import type { FarmId } from './farm.js';
import type { OperatorId } from './operator.js';

// Insumo del IntentClassifier/EventExtractor: contexto mínimo de la granja
// del operario para desambiguar (nombres de ítems, chapetas conocidas, etc.).
export interface FarmContext {
  readonly farmId: FarmId | null;
  readonly operatorId: OperatorId | null;
  readonly itemNames: readonly string[];
  readonly chapetas: readonly string[];
  readonly activeLotCount: number;
  readonly hasPending: boolean;
}

// Contexto de un usuario no registrado (P2 de PLAN-v1.1.md): el asesor
// v1 sigue respondiendo igual; solo se usa este valor por defecto.
export const ANONYMOUS_FARM_CONTEXT: FarmContext = {
  farmId: null,
  operatorId: null,
  itemNames: [],
  chapetas: [],
  activeLotCount: 0,
  hasPending: false,
};
