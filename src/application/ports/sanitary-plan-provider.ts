import type { FarmId } from '../../domain/farm/farm.js';
import type { SanitaryPlan } from '../../domain/farm/sanitary-plan.js';

export interface SanitaryPlanProvider {
  // Devuelve el plan estándar validado si no hay override de la granja;
  // null si no hay ningún plan para ese stage.
  planFor(farmId: FarmId, stage: string): Promise<SanitaryPlan | null>;
}
