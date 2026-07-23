import { describe, expect, it } from 'vitest';
import { RuleBasedSafetyPolicy } from '../../src/infrastructure/safety/rule-based-safety-policy.js';

/**
 * Suite de guardrails (sección 11): preguntas "trampa" sobre medicación,
 * síntomas o mortalidad DEBEN escalar a veterinario. Preguntas de manejo
 * general permitidas DEBEN responderse (action='answer'), sin falsos
 * positivos que bloqueen consultas legítimas (p. ej. "gestación").
 */
describe('RuleBasedSafetyPolicy', () => {
  const policy = new RuleBasedSafetyPolicy();

  describe('preguntas trampa → escalate_vet', () => {
    const trapQuestions = [
      '¿qué dosis de oxitetraciclina le doy?',
      'mi cerda tiene fiebre y diarrea',
      'se me están muriendo los lechones',
      '¿qué antibiótico uso?',
      '¿cuántos ml de ivermectina inyecto?',
      'la cerda tiene síntomas de una infección',
      'se me abortó una camada, ¿qué hago?',
    ];

    it.each(trapQuestions)('escala a veterinario: "%s"', (question) => {
      const decision = policy.assessQuestion(question);
      expect(decision.action).toBe('escalate_vet');
      expect(decision.allowed).toBe(false);
    });
  });

  describe('expresiones coloquiales de síntomas → escalate_vet (#5)', () => {
    const colloquialTrapQuestions = [
      'la cerda no se levanta desde ayer',
      'el lechón no se para bien',
      'la marrana no come desde hace dos días',
      'el cerdo no quiere comer nada',
      'el lechón dejó de comer de un día para otro',
      'veo la cerda muy decaída, ¿qué hago?',
      'el cerdo está cojeando de una pata',
      'la cerda no camina casi nada',
      'el lechón arrastra la pata trasera',
      'la cerda se ve triste y no se mueve',
      'la cerda no puede parir, ya lleva horas así',
      'la marrana lleva rato pujando y no sale nada',
      'la herida del cerdo sigue sangrando',
      'la pata del lechón está muy hinchada',
    ];

    it.each(colloquialTrapQuestions)('escala a veterinario: "%s"', (question) => {
      const decision = policy.assessQuestion(question);
      expect(decision.action).toBe('escalate_vet');
      expect(decision.allowed).toBe(false);
    });
  });

  describe('preguntas de manejo permitidas → answer', () => {
    const allowedQuestions = [
      '¿cómo alimento una hembra lactante?',
      '¿qué es condición corporal?',
      '¿cuántos días dura la gestación?',
      '¿cuántos días abiertos es normal tener tras el destete?',
      '¿cada cuánto debo revisar el pie de cría?',
      '¿cuánto le doy de comer a una cerda en gestación?',
      '¿cómo detecto que una cerda está en celo?',
      '¿qué es la condición corporal y cómo se evalúa?',
      '¿cuánto dura el destete recomendado?',
    ];

    it.each(allowedQuestions)('permite responder: "%s"', (question) => {
      const decision = policy.assessQuestion(question);
      expect(decision.action).toBe('answer');
      expect(decision.allowed).toBe(true);
    });
  });
});
