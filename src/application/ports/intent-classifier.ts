import type { FarmContext } from '../../domain/farm/farm-context.js';
import type { Intent } from '../../domain/intent/intent.js';
import type { Result } from '../../domain/shared/result.js';

export interface ClassifierError {
  readonly kind: 'provider_failure' | 'invalid_output';
  readonly message: string;
}

export interface IntentClassifier {
  classify(text: string, ctx: FarmContext): Promise<Result<Intent, ClassifierError>>;
}
