import {
  allowAnswer,
  escalateToVet,
  type SafetyDecision,
} from '../../domain/safety/safety-decision.js';
import type { SafetyPolicy } from '../../application/ports/safety-policy.js';

/**
 * Guardrail por reglas (sección 11): detecta temas sanitarios, de
 * medicación/dosis, síntomas de enfermedad y mortalidad, y ordena
 * escalar al veterinario SIN intentar dar la respuesta técnica.
 * Es un puerto: se puede reemplazar por un clasificador sin tocar el caso de uso.
 */
export class RuleBasedSafetyPolicy implements SafetyPolicy {
  assessQuestion(question: string): SafetyDecision {
    const text = normalize(question);
    const hit = ESCALATION_PATTERNS.find((pattern) => pattern.regex.test(text));
    if (hit !== undefined) {
      return escalateToVet(hit.reason);
    }
    return allowAnswer();
  }

  reviewAnswer(question: string, draft: string): SafetyDecision {
    const hit = ESCALATION_PATTERNS.find((pattern) => pattern.regex.test(normalize(draft)));
    if (hit !== undefined) {
      return escalateToVet(hit.reason);
    }
    return this.assessQuestion(question);
  }
}

interface EscalationPattern {
  readonly regex: RegExp;
  readonly reason: string;
}

// Los patrones se evalúan sobre texto normalizado (minúsculas, sin acentos).
const ESCALATION_PATTERNS: readonly EscalationPattern[] = [
  {
    regex:
      /\b(medic|farmac|antibiotic|antiparasit|desparasit|vacun|dosis|dosific|inyect|oxitetraciclin|penicilin|amoxicilin|ivermectin|hierro dextran|vitamina k)\w*/,
    reason: 'consulta sobre medicación, dosis o vacunación',
  },
  {
    regex: /\b\d+\s?(mg|ml|cc|ui)\b/,
    reason: 'consulta que menciona una dosis numérica de fármaco',
  },
  {
    regex:
      /\b(enferm|sintom|diagnostic|fiebre|diarr|infecci|virus|bacteri|peste|convuls|temblor|vomit)\w*/,
    reason: 'consulta sobre síntomas o diagnóstico de enfermedad',
  },
  {
    regex: /\b(muert|muri|morir|mortalidad|abort)\w*/,
    reason: 'consulta sobre mortalidad o aborto',
  },
];

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
