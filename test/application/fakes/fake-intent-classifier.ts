import type { FarmContext } from '../../../src/domain/farm/farm-context.js';
import type { Intent } from '../../../src/domain/intent/intent.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { err, ok } from '../../../src/domain/shared/result.js';
import type {
  ClassifierError,
  IntentClassifier,
} from '../../../src/application/ports/intent-classifier.js';

export class FakeIntentClassifier implements IntentClassifier {
  readonly calls: string[] = [];
  readonly respuestas = new Map<string, Intent>();
  defaultIntent: Intent = { kind: 'question', confidence: 0.9 };
  failure?: ClassifierError;

  async classify(text: string, _ctx: FarmContext): Promise<Result<Intent, ClassifierError>> {
    this.calls.push(text);
    if (this.failure) {
      return err(this.failure);
    }
    return ok(this.respuestas.get(text) ?? this.defaultIntent);
  }
}
