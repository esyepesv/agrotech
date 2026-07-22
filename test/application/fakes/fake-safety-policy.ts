import type { SafetyDecision } from '../../../src/domain/safety/safety-decision.js';
import { allowAnswer, escalateToVet } from '../../../src/domain/safety/safety-decision.js';
import type { SafetyPolicy } from '../../../src/application/ports/safety-policy.js';

export class FakeSafetyPolicy implements SafetyPolicy {
  readonly assessedQuestions: string[] = [];
  readonly reviewedDrafts: { question: string; draft: string }[] = [];

  constructor(
    private readonly escalateKeywords: string[] = [],
    private readonly reviewEscalateKeywords: string[] = [],
  ) {}

  assessQuestion(question: string): SafetyDecision {
    this.assessedQuestions.push(question);
    const lowered = question.toLowerCase();
    const hit = this.escalateKeywords.find((keyword) => lowered.includes(keyword));
    return hit === undefined ? allowAnswer() : escalateToVet(`keyword: ${hit}`);
  }

  reviewAnswer(question: string, draft: string): SafetyDecision {
    this.reviewedDrafts.push({ question, draft });
    const lowered = draft.toLowerCase();
    const hit = this.reviewEscalateKeywords.find((keyword) => lowered.includes(keyword));
    return hit === undefined ? allowAnswer() : escalateToVet(`draft keyword: ${hit}`);
  }
}
