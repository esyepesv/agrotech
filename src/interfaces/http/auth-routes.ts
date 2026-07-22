import cors from '@fastify/cors';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppUser } from '../../domain/farm/app-user.js';
import type { OtpDestinationKind } from '../../domain/otp/otp-destination.js';
import type { VerifyAccountDestination } from '../../application/use-cases/verify-account-destination.js';
import {
  parseRequestOtpInput,
  parseVerifyOtpInput,
  requestOtpResponse,
  type BodyRequest,
  type HttpResponse,
  type RegistrationHttpDeps,
} from './register-routes.js';
import { OtpRateLimiter } from './otp-rate-limiter.js';

export interface AuthHttpDeps {
  readonly registration: RegistrationHttpDeps;
  readonly verifyAccountDestination: VerifyAccountDestination;
}

export interface AuthenticatedBodyRequest extends BodyRequest {
  readonly authorization: string | undefined;
}

export interface AuthHandlers {
  readonly accountRequestOtp: (req: AuthenticatedBodyRequest) => Promise<HttpResponse>;
  readonly accountVerifyOtp: (req: AuthenticatedBodyRequest) => Promise<HttpResponse>;
}

function errorResponse(status: number, code: string, message: string): HttpResponse {
  return { status, body: { error: { code, message } } };
}

function verifiedUserId(deps: AuthHttpDeps, authorization: string | undefined): string | undefined {
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (token === undefined) {
    return undefined;
  }
  const claims = deps.registration.sessionIssuer.verify(token);
  return claims.ok ? claims.value.userId : undefined;
}

function accountOwnsDestination(
  user: AppUser,
  destinationKind: OtpDestinationKind,
  destination: string,
  hashUserId: (raw: string) => string,
): boolean {
  return destinationKind === 'phone'
    ? hashUserId(destination) === user.phoneHash
    : destination === user.email;
}

async function handleAccountRequestOtp(
  deps: AuthHttpDeps,
  limiter: OtpRateLimiter,
  req: AuthenticatedBodyRequest,
): Promise<HttpResponse> {
  const userId = verifiedUserId(deps, req.authorization);
  if (userId === undefined) {
    return errorResponse(401, 'unauthorized', 'Tu sesión no es válida. Ingresa de nuevo.');
  }

  const input = parseRequestOtpInput(req.body);
  if (input === undefined) {
    return errorResponse(400, 'validation', 'Revisa los datos del formulario.');
  }

  const user = await deps.registration.farmRepository.findUserById(userId);
  if (
    user === null ||
    !accountOwnsDestination(
      user,
      input.destinationKind,
      input.destination,
      deps.registration.hashUserId,
    )
  ) {
    return errorResponse(403, 'destination_mismatch', 'Ese celular o correo no pertenece a tu cuenta.');
  }

  return requestOtpResponse(deps.registration, limiter, input);
}

async function handleAccountVerifyOtp(
  deps: AuthHttpDeps,
  req: AuthenticatedBodyRequest,
): Promise<HttpResponse> {
  const userId = verifiedUserId(deps, req.authorization);
  if (userId === undefined) {
    return errorResponse(401, 'unauthorized', 'Tu sesión no es válida. Ingresa de nuevo.');
  }

  const input = parseVerifyOtpInput(req.body);
  if (input === undefined) {
    return errorResponse(400, 'invalid_code', 'Revisa el código e inténtalo de nuevo.');
  }

  const outcome = await deps.verifyAccountDestination.verify({
    userId,
    destination: input.destination,
    code: input.code,
  });
  if (outcome.ok) {
    return { status: 200, body: { verified: true, destinationKind: outcome.value.destinationKind } };
  }

  switch (outcome.error.kind) {
    case 'destination_mismatch':
      return errorResponse(403, outcome.error.kind, outcome.error.message);
    case 'invalid_code':
      return errorResponse(400, outcome.error.kind, outcome.error.message);
    case 'expired':
      return errorResponse(410, 'expired_code', outcome.error.message);
    case 'too_many_attempts':
      return errorResponse(429, outcome.error.kind, outcome.error.message);
    case 'persistence':
      return errorResponse(500, outcome.error.kind, outcome.error.message);
  }
}

/** Handlers HTTP-agnósticos para cuenta autenticada; reutilizados por Fastify y Vercel. */
export function createAuthHandlers(deps: AuthHttpDeps): AuthHandlers {
  const requestOtpLimiter = new OtpRateLimiter(
    {
      maxPerWindow: deps.registration.config.otpRateLimitPerHour,
      windowSeconds: 3600,
      cooldownSeconds: deps.registration.config.otpResendCooldownSeconds,
    },
    deps.registration.clock,
  );

  return {
    accountRequestOtp: (req) => handleAccountRequestOtp(deps, requestOtpLimiter, req),
    accountVerifyOtp: (req) => handleAccountVerifyOtp(deps, req),
  };
}

function sendHttpResponse(reply: FastifyReply, response: HttpResponse): FastifyReply {
  if (response.headers !== undefined) {
    for (const [key, value] of Object.entries(response.headers)) {
      void reply.header(key, value);
    }
  }
  return reply.code(response.status).send(response.body);
}

/** Registra las rutas autenticadas de cuenta; Task 6 añade aquí `/auth/*`. */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthHttpDeps): void {
  const handlers = createAuthHandlers(deps);

  app.register(async (scope) => {
    if (deps.registration.config.corsAllowedOrigins.length > 0) {
      await scope.register(cors, {
        origin: [...deps.registration.config.corsAllowedOrigins],
        methods: ['POST', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type'],
      });
    }

    scope.post('/account/request-otp', async (request, reply) =>
      sendHttpResponse(
        reply,
        await handlers.accountRequestOtp({
          body: request.body,
          authorization: request.headers.authorization,
        }),
      ),
    );
    scope.post('/account/verify-otp', async (request, reply) =>
      sendHttpResponse(
        reply,
        await handlers.accountVerifyOtp({
          body: request.body,
          authorization: request.headers.authorization,
        }),
      ),
    );
  });
}
