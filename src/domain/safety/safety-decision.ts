export type SafetyAction = 'answer' | 'escalate_vet' | 'refuse';

export interface SafetyDecision {
  readonly allowed: boolean;
  readonly action: SafetyAction;
  readonly reason: string;
}

export function allowAnswer(reason = 'consulta de manejo permitida'): SafetyDecision {
  return { allowed: true, action: 'answer', reason };
}

export function escalateToVet(reason: string): SafetyDecision {
  return { allowed: false, action: 'escalate_vet', reason };
}

export function refuse(reason: string): SafetyDecision {
  return { allowed: false, action: 'refuse', reason };
}
