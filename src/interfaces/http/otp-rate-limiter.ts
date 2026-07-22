import type { Clock } from '../../application/ports/clock.js';

export interface RateLimiterConfig {
  readonly maxPerWindow: number;
  readonly windowSeconds: number;
  /** Espaciado mínimo entre solicitudes consecutivas a la misma llave (opcional). */
  readonly cooldownSeconds?: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

/**
 * Limitador de tasa en memoria (spec 001 §4.2/§5): máximo `maxPerWindow`
 * solicitudes por llave dentro de `windowSeconds`, más un cooldown mínimo
 * opcional entre solicitudes consecutivas a la misma llave. Se usa para
 * `request-otp` (cuota horaria por destino + cooldown de reenvío) y, con una
 * cuota más holgada y sin cooldown, para `farms/search` (por IP).
 *
 * IMPORTANTE (serverless): esta implementación vive en un `Map` de proceso,
 * sin persistencia externa. En Vercel cada instancia de función tiene su
 * propio contador — no hay estado compartido entre instancias frías/
 * calientes ni entre regiones, así que el límite es "best effort" en
 * producción serverless hasta que se mueva a una tabla de Postgres (fuera de
 * alcance de este corte). En el servidor Fastify local (un solo proceso) sí
 * es exacto.
 */
export class OtpRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly config: RateLimiterConfig,
    private readonly clock: Clock,
  ) {}

  check(key: string): RateLimitDecision {
    const now = this.clock.now().getTime();
    const windowStartMs = now - this.config.windowSeconds * 1000;
    // Limpieza perezosa: se descartan marcas fuera de la ventana en cada
    // llamada en vez de correr un job de fondo (mismo espíritu que
    // pending_event / otp_code en la persistencia).
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStartMs);

    const cooldown = this.config.cooldownSeconds;
    const last = timestamps[timestamps.length - 1];
    if (cooldown !== undefined && last !== undefined) {
      const elapsedSeconds = (now - last) / 1000;
      if (elapsedSeconds < cooldown) {
        this.hits.set(key, timestamps);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(cooldown - elapsedSeconds)),
        };
      }
    }

    if (timestamps.length >= this.config.maxPerWindow) {
      const oldest = timestamps[0];
      const retryAfterMs =
        oldest !== undefined
          ? oldest + this.config.windowSeconds * 1000 - now
          : this.config.windowSeconds * 1000;
      this.hits.set(key, timestamps);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true };
  }
}
