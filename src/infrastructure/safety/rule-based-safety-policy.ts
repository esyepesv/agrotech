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
  // Expresiones coloquiales de síntomas/enfermedad (#5 hardening): el
  // productor rara vez dice "diagnóstico" o "síntoma"; describe lo que ve.
  // Se prioriza escalar ante ambigüedad de salud sin bloquear preguntas de
  // manejo rutinario (alimentación, celo, condición corporal, gestación,
  // destete): p. ej. "no come"/"no quiere comer"/"dejó de comer" escala,
  // pero "¿cuánto le doy de comer?" (sin "no come") sigue respondiéndose.
  {
    regex: /no\s+se\s+(levanta\w*|para\b|puede\s+(parar|levantar)\w*)/,
    reason: 'consulta sobre un animal que no se levanta o no se para (signo de enfermedad)',
  },
  {
    regex: /(no\s+come\b|no\s+quiere\s+comer|dejo\s+de\s+comer)/,
    reason: 'consulta sobre un animal que dejó de comer (signo de enfermedad)',
  },
  {
    regex: /decaid\w*/,
    reason: 'consulta sobre un animal decaído (signo de enfermedad)',
  },
  {
    regex: /\b(cojea\w*|cojera|cojo|coja)\b/,
    reason: 'consulta sobre cojera (signo de enfermedad o lesión)',
  },
  {
    regex: /no\s+camina/,
    reason: 'consulta sobre un animal que no camina',
  },
  {
    regex: /arrastr\w*/,
    reason: 'consulta sobre un animal que arrastra alguna extremidad',
  },
  {
    regex: /se\s+ve\s+trist\w*/,
    reason: 'consulta sobre un animal que se ve triste o decaído',
  },
  {
    regex: /no\s+puede\s+parir/,
    reason: 'consulta sobre dificultad de parto (distocia)',
  },
  {
    regex: /pujando|atascad\w*/,
    reason: 'consulta sobre pujos o atascamiento durante el parto (distocia)',
  },
  {
    regex: /\bsangr\w*/,
    reason: 'consulta sobre sangrado',
  },
  {
    regex: /hincha\w*/,
    reason: 'consulta sobre hinchazón o inflamación',
  },
];

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
