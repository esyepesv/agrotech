import cors from '@fastify/cors';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../application/ports/clock.js';
import type { LeadNotifier } from '../../application/ports/lead-notifier.js';
import type { LeadStore } from '../../application/ports/lead-store.js';
import { OtpRateLimiter } from './otp-rate-limiter.js';

export interface LeadHttpDeps {
  readonly store: LeadStore;
  readonly notifier: LeadNotifier;
  readonly clock: Clock;
  readonly corsAllowedOrigins: readonly string[];
}

export interface LeadHandlers {
  submit(request: { body: unknown; ip: string; idempotencyKey: string | undefined }): Promise<HttpResponse>;
}

interface HttpResponse { readonly status: number; readonly body: unknown; readonly headers?: Record<string, string>; }

const common = z.object({
  name: z.string().trim().min(2).max(120),
  consent: z.literal(true),
  website: z.string().max(0).optional(),
});
const leadSchema = z.discriminatedUnion('type', [
  common.extend({
    type: z.literal('pilot'),
    whatsapp: z.string().trim().min(7).max(24),
    farmDetails: z.string().trim().max(220).optional(),
    interestedInManagement: z.boolean().optional(),
  }),
  common.extend({
    type: z.literal('partner'),
    email: z.string().trim().email().max(254),
    organization: z.string().trim().min(2).max(160),
    message: z.string().trim().max(2000).optional(),
  }),
]);

export function createLeadHandlers(deps: LeadHttpDeps): LeadHandlers {
  const limiter = new OtpRateLimiter({ maxPerWindow: 5, windowSeconds: 3600 }, deps.clock);
  return {
    async submit(request) {
      const rate = limiter.check(request.ip);
      if (!rate.allowed) {
        return errorResponse(429, 'rate_limited', 'Espera un momento antes de enviar otro formulario.', rate.retryAfterSeconds);
      }
      if (request.idempotencyKey === undefined || request.idempotencyKey.length < 8 || request.idempotencyKey.length > 128) {
        return errorResponse(400, 'invalid_request', 'No pudimos validar el envío. Inténtalo de nuevo.');
      }
      const parsed = leadSchema.safeParse(request.body);
      if (!parsed.success) return errorResponse(400, 'validation', 'Revisa los datos requeridos e inténtalo de nuevo.');
      // `website` es el honeypot: se separa del resto (que es justo el Lead a
      // guardar) y se usa aquí mismo, así no queda una variable descartada.
      const { website, ...lead } = parsed.data;
      if (website !== undefined && website.length > 0) return { status: 201, body: { ok: true } };

      const stored = await deps.store.save(lead, request.idempotencyKey);
      if (stored === 'duplicate') return { status: 201, body: { ok: true } };
      if (!(await deps.notifier.notify(lead))) {
        return errorResponse(503, 'notification_failed', 'Guardamos tu contacto, pero no pudimos confirmar el envío. Inténtalo de nuevo más tarde.');
      }
      return { status: 201, body: { ok: true } };
    },
  };
}

export function registerLeadRoutes(app: FastifyInstance, deps: LeadHttpDeps): void {
  const handlers = createLeadHandlers(deps);
  app.register(async (scope) => {
    await scope.register(cors, { origin: [...deps.corsAllowedOrigins], methods: ['POST', 'OPTIONS'] });
    scope.post('/leads', async (request, reply) => send(reply, await handlers.submit({
      body: request.body,
      ip: request.ip,
      idempotencyKey: typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined,
    })));
  });
}

function errorResponse(status: number, code: string, message: string, retryAfter?: number): HttpResponse {
  return { status, body: { error: { code, message } }, headers: retryAfter === undefined ? undefined : { 'Retry-After': String(retryAfter) } };
}

function send(reply: FastifyReply, response: HttpResponse): FastifyReply {
  if (response.headers !== undefined) for (const [key, value] of Object.entries(response.headers)) reply.header(key, value);
  return reply.code(response.status).send(response.body);
}
