import type { SafetyDecision } from '../../domain/safety/safety-decision.js';

export interface SafetyPolicy {
  /** Pre-generación (síncrona, barata). */
  assessQuestion(question: string): SafetyDecision;
  /** Post-generación (opcional en MVP). */
  reviewAnswer(question: string, draft: string): SafetyDecision;
}
