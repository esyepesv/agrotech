import type { KnowledgeReference, RetrievedChunk } from '../../domain/knowledge/retrieved-chunk.js';
import type { Locale } from '../../domain/message/incoming-message.js';
import type { Result } from '../../domain/shared/result.js';

export interface Turn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface GenerationInput {
  readonly question: string;
  readonly context: readonly RetrievedChunk[];
  readonly locale: Locale;
  readonly history?: readonly Turn[];
}

export interface GeneratedAnswer {
  readonly text: string;
  readonly usedSources: readonly KnowledgeReference[];
}

export interface GenerationError {
  readonly kind: 'provider_failure' | 'empty_answer';
  readonly message: string;
}

export interface AnswerGenerator {
  generate(input: GenerationInput): Promise<Result<GeneratedAnswer, GenerationError>>;
}
