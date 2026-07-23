import type { Result } from '../../../src/domain/shared/result.js';
import { ok } from '../../../src/domain/shared/result.js';
import type {
  AnswerGenerator,
  GeneratedAnswer,
  GenerationError,
  GenerationInput,
} from '../../../src/application/ports/answer-generator.js';

export class FakeAnswerGenerator implements AnswerGenerator {
  readonly inputs: GenerationInput[] = [];

  constructor(
    private readonly result: Result<GeneratedAnswer, GenerationError> = ok({
      text: 'Aliméntala a voluntad durante la lactancia, repartido en 2 o 3 comidas.',
      usedSources: [{ id: 'chunk-1', source: 'alimentacion.md' }],
    }),
  ) {}

  async generate(input: GenerationInput): Promise<Result<GeneratedAnswer, GenerationError>> {
    this.inputs.push(input);
    return this.result;
  }
}
