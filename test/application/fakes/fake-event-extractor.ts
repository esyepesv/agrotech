import type { FarmContext } from '../../../src/domain/farm/farm-context.js';
import type { EventSource, FarmEventDraft } from '../../../src/domain/farm/farm-event.js';
import type { Result } from '../../../src/domain/shared/result.js';
import { err, ok } from '../../../src/domain/shared/result.js';
import type {
  EventExtractor,
  ExtractionError,
} from '../../../src/application/ports/event-extractor.js';

export class FakeEventExtractor implements EventExtractor {
  readonly calls: string[] = [];
  readonly respuestas = new Map<string, FarmEventDraft>();
  failure?: ExtractionError;

  async extract(
    text: string,
    _ctx: FarmContext,
    _source: EventSource,
  ): Promise<Result<FarmEventDraft, ExtractionError>> {
    this.calls.push(text);
    if (this.failure) {
      return err(this.failure);
    }
    const draft = this.respuestas.get(text);
    if (!draft) {
      return err({
        kind: 'unrecognized_event',
        message: `sin draft programado para: ${text}`,
      });
    }
    return ok(draft);
  }
}
