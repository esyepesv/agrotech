import type { FarmId } from './farm.js';
import type { PlanTask } from './plan-task.js';

// scope 'standard' = plan genérico validado; un farmId indica un override
// específico de esa granja. Unión discriminada (y no 'standard' | FarmId,
// que colapsaría a string) para que el chequeo de override sea tipado.
export type PlanScope =
  | { readonly kind: 'standard' }
  | { readonly kind: 'farm'; readonly farmId: FarmId };

export const STANDARD_PLAN_SCOPE: PlanScope = { kind: 'standard' };

export interface SanitaryPlan {
  readonly id: string;
  readonly scope: PlanScope;
  readonly stage: string;
  readonly tasks: readonly PlanTask[];
  readonly validatedBy: string | null;
}

// Regla dura de seguridad (§8/§12 de PLAN-v1.1.md): un recordatorio sanitario
// solo puede citar un plan validado por alguien, nunca uno sin validar.
export function isValidatedPlan(plan: SanitaryPlan): boolean {
  return plan.validatedBy !== null;
}
