import cors from '@fastify/cors';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppUser } from '../../domain/farm/app-user.js';
import type { OtpDestinationKind } from '../../domain/otp/otp-destination.js';
import type { VerifyAccountDestination } from '../../application/use-cases/verify-account-destination.js';
import type { LoginWithOtp } from '../../application/use-cases/login-with-otp.js';
import {
  otpRateLimitResponse,
  parseRequestOtpInput,
  parseVerifyOtpInput,
  requestOtpResponse,
  sendOtpResponse,
  type BodyRequest,
  type HttpResponse,
  type RegistrationHttpDeps,
} from './register-routes.js';
import { OtpRateLimiter } from './otp-rate-limiter.js';

export interface AuthHttpDeps {
  readonly registration: RegistrationHttpDeps;
  readonly verifyAccountDestination: VerifyAccountDestination;
  readonly loginWithOtp: LoginWithOtp;
}

export interface AuthenticatedBodyRequest extends BodyRequest {
  readonly authorization: string | undefined;
}

export interface AuthHandlers {
  readonly accountRequestOtp: (req: AuthenticatedBodyRequest) => Promise<HttpResponse>;
  readonly accountVerifyOtp: (req: AuthenticatedBodyRequest) => Promise<HttpResponse>;
  readonly authDestinations: (req: BodyRequest) => Promise<HttpResponse>;
  readonly authRequestOtp: (req: BodyRequest) => Promise<HttpResponse>;
  readonly authVerifyOtp: (req: BodyRequest) => Promise<HttpResponse>;
}

const loginDestinationsSchema = z.object({ identifier: z.string() });
const loginRequestOtpSchema = z.object({
  identifier: z.string().min(1),
  destinationKind: z.enum(['phone', 'email']),
  transport: z.enum(['whatsapp', 'telegram', 'sms', 'email']),
});
const loginVerifyOtpSchema = z.object({
  identifier: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

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

function otpSuccessResponse(deps: AuthHttpDeps): HttpResponse {
  return {
    status: 200,
    body: {
      ok: true,
      expiresInSeconds: deps.registration.config.otpTtlSeconds,
      resendAfterSeconds: deps.registration.config.otpResendCooldownSeconds,
    },
  };
}

async function handleAuthDestinations(deps: AuthHttpDeps, req: BodyRequest): Promise<HttpResponse> {
  const parsed = loginDestinationsSchema.safeParse(req.body);
  // Incluso si el identificador tiene una forma inválida, se conserva la
  // respuesta uniforme: este endpoint no confirma la existencia de cuentas.
  const identifier = parsed.success ? parsed.data.identifier : '';
  const outcome = await deps.loginWithOtp.destinations({ identifier });
  if (!outcome.ok) {
    // `destinations` no tiene fallos de negocio; este guard mantiene el
    // límite HTTP completo si el caso de uso incorpora alguno en el futuro.
    return errorResponse(500, 'internal', 'No pudimos preparar el inicio de sesión.');
  }
  return { status: 200, body: outcome.value };
}

async function handleAuthRequestOtp(
  deps: AuthHttpDeps,
  limiter: OtpRateLimiter,
  req: BodyRequest,
): Promise<HttpResponse> {
  const parsed = loginRequestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(400, 'validation', 'Revisa los datos del formulario.');
  }

  const identifierKey = `login:${parsed.data.identifier.trim().toLowerCase()}`;
  const limited = otpRateLimitResponse(limiter, identifierKey);
  if (limited !== undefined) {
    return limited;
  }
  if (!deps.registration.otpSender.availableTransports().includes(parsed.data.transport)) {
    return errorResponse(
      503,
      'channel_not_configured',
      'Ese medio para recibir el código no está disponible ahora. Prueba con otro.',
    );
  }

  const destination = await deps.loginWithOtp.emailDestination(parsed.data.identifier);
  // Mantener 200 si la cuenta no existe (o se pide un destino que esta
  // versión no puede recuperar) evita que este endpoint revele cuentas.
  if (destination === null || parsed.data.destinationKind !== 'email') {
    return otpSuccessResponse(deps);
  }
  return sendOtpResponse(deps.registration, {
    destination,
    destinationKind: 'email',
    transport: parsed.data.transport,
  });
}

async function handleAuthVerifyOtp(deps: AuthHttpDeps, req: BodyRequest): Promise<HttpResponse> {
  const parsed = loginVerifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(401, 'invalid_credentials', 'No pudimos validar esos datos.');
  }
  const outcome = await deps.loginWithOtp.verify(parsed.data);
  return outcome.ok
    ? { status: 200, body: outcome.value }
    : errorResponse(401, outcome.error.kind, outcome.error.message);
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
  const loginRequestOtpLimiter = new OtpRateLimiter(
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
    authDestinations: (req) => handleAuthDestinations(deps, req),
    authRequestOtp: (req) => handleAuthRequestOtp(deps, loginRequestOtpLimiter, req),
    authVerifyOtp: (req) => handleAuthVerifyOtp(deps, req),
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

/** Registra las rutas de cuenta autenticada y de login por OTP. */
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
    scope.post('/auth/destinations', async (request, reply) =>
      sendHttpResponse(reply, await handlers.authDestinations({ body: request.body })),
    );
    scope.post('/auth/request-otp', async (request, reply) =>
      sendHttpResponse(reply, await handlers.authRequestOtp({ body: request.body })),
    );
    scope.post('/auth/verify-otp', async (request, reply) =>
      sendHttpResponse(reply, await handlers.authVerifyOtp({ body: request.body })),
    );
  });
}
