import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({ level });
}

export function withCorrelationId(logger: Logger, correlationId: string): Logger {
  return logger.child({ correlationId });
}
