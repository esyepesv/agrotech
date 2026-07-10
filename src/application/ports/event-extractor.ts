import type { FarmContext } from '../../domain/farm/farm-context.js';
import type { EventSource, FarmEventDraft } from '../../domain/farm/farm-event.js';
import type { Result } from '../../domain/shared/result.js';

export interface ExtractionError {
  readonly kind: 'provider_failure' | 'invalid_output' | 'unrecognized_event';
  readonly message: string;
}

export interface EventExtractor {
  // El extractor nunca persiste (guardrail): siempre produce un draft que
  // LogFarmEvent debe confirmar antes de tocar el ledger.
  extract(
    text: string,
    ctx: FarmContext,
    source: EventSource,
  ): Promise<Result<FarmEventDraft, ExtractionError>>;
}
