export type IntentKind =
  | 'question'
  | 'log_event'
  | 'query_state'
  | 'onboarding'
  | 'confirm'
  | 'cancel'
  | 'unknown';

export interface Intent {
  readonly kind: IntentKind;
  readonly confidence: number;
}

// Por debajo de este umbral, el router trata la intención como 'question'
// (rama por defecto v1, ver PLAN-v1.1.md §2/§6): nunca deja peor a v1.
export const INTENT_CONFIDENCE_THRESHOLD = 0.6;
