export interface ResilienceOptions {
  readonly timeoutMs: number;
  readonly retries: number;
  readonly baseDelayMs: number;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
  timeoutMs: 30_000,
  retries: 2,
  baseDelayMs: 500,
};

const RETRIABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * fetch con timeout por intento y reintentos con backoff exponencial.
 * Encapsula la resiliencia de las llamadas a APIs externas (sección 14),
 * invisible para el caso de uso.
 */
export async function resilientFetch(
  input: string,
  init: RequestInit,
  options: ResilienceOptions = DEFAULT_RESILIENCE,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, options.timeoutMs);

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (RETRIABLE_STATUS.has(response.status) && attempt < options.retries) {
        lastError = new Error(`HTTP ${String(response.status)}`);
        await backoff(options.baseDelayMs, attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) {
        break;
      }
      await backoff(options.baseDelayMs, attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('resilientFetch failed');
}

function backoff(baseDelayMs: number, attempt: number): Promise<void> {
  const delay = baseDelayMs * 2 ** attempt;
  return new Promise((resolve) => setTimeout(resolve, delay));
}
