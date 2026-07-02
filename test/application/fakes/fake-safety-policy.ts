import type { SafetyDecision } from '../../../src/domain/safety/safety-decision.js';
import { allowAnswer, escalateToVet } from '../../../src/domain/safety/safety-decision.js';
import type { SafetyPolicy } from '../../../src/application/ports/safety-policy.js';

export class FakeSafetyPolicy implements SafetyPolicy {
  readonly assessedQuestions: string[] = [];

  constructor(private readonly escalateKeywords: string[] = []) {}

  assessQuestion(question: string): SafetyDecision {
    this.assessedQuestions.push(question);
    const lowered = question.toLowerCase();
    const hit = this.escalateKeywords.find((keyword) => lowered.includes(keyword));
    return hit === undefined ? allowAnswer() : escalateToVet(`keyword: ${hit}`);
  }

  reviewAnswer(_question: string, _draft: string): SafetyDecision {
    return allowAnswer();
  }
}
