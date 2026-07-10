export type PlanTaskAppliesTo = 'sow' | 'lot';

export type PlanTaskAnchor = 'parto' | 'ingreso' | 'inseminacion';

export type PlanTaskKind = 'vacuna' | 'limpieza' | 'destete' | 'cambioConcentrado';

// Tarea de un SanitaryPlan: se ubica en el tiempo por un offset desde un
// ancla del ciclo productivo (parto/ingreso/inseminación), no por fecha fija.
export interface PlanTask {
  readonly id: string;
  readonly label: string;
  readonly appliesTo: PlanTaskAppliesTo;
  readonly offsetDays: number;
  readonly anchor: PlanTaskAnchor;
  readonly kind: PlanTaskKind;
}
