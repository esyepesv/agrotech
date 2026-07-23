import { describe, expect, it } from 'vitest';
import { allowAnswer, escalateToVet, refuse } from '../../src/domain/safety/safety-decision.js';

describe('SafetyDecision', () => {
  it('allowAnswer produce action=answer permitida', () => {
    const decision = allowAnswer();
    expect(decision).toMatchObject({ allowed: true, action: 'answer' });
  });

  it('escalateToVet produce action=escalate_vet no permitida', () => {
    const decision = escalateToVet('menciona dosis de antibiótico');
    expect(decision).toMatchObject({
      allowed: false,
      action: 'escalate_vet',
      reason: 'menciona dosis de antibiótico',
    });
  });

  it('refuse produce action=refuse no permitida', () => {
    const decision = refuse('fuera de alcance');
    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe('refuse');
  });
});
