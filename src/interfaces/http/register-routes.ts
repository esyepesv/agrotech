import cors from '@fastify/cors';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../application/ports/clock.js';
import type { FarmRepository } from '../../application/ports/farm-repository.js';
import type { OtpSender } from '../../application/ports/otp-sender.js';
import type { OtpTransport } from '../../application/ports/otp-store.js';
import type { OtpStore } from '../../application/ports/otp-store.js';
import type { SessionIssuer } from '../../application/ports/session-issuer.js';
import type { RegisterFarmAndUser } from '../../application/use-cases/register-farm-and-user.js';
import type {
  RegisterFarmAndUserInput,
  RegistrationError,
  UserInput,
} from '../../domain/farm/registration.js';
import { isValidColombianMobile, validateUserInput } from '../../domain/farm/registration.js';
import type { OtpDestinationKind } from '../../domain/otp/otp-destination.js';
import { normalizeDestination } from '../../domain/otp/otp-destination.js';
import { generateOtpCode } from '../../infrastructure/security/otp-code.js';
import { OtpRateLimiter } from './otp-rate-limiter.js';

/**
 * Dependencias que este adaptador necesita para funcionar (spec 001 §4.2 y
 * §5). El composition root (`src/config/container.ts`, fuera de este
 * archivo) construye un `Container.registration: RegistrationHttpDeps` real
 * con los adaptadores de infraestructura; los tests lo arman con fakes
 * in-memory (`test/application/fakes/`).
 */
export interface RegistrationHttpDeps {
  readonly registerFarmAndUser: RegisterFarmAndUser;
  readonly farmRepository: FarmRepository;
  readonly otpStore: OtpStore;
  readonly otpSender: OtpSender;
  readonly sessionIssuer: SessionIssuer;
  readonly clock: Clock;
  readonly hashUserId: (raw: string) => string;
  readonly config: {
    readonly otpTtlSeconds: number;
    readonly otpMaxAttempts: number;
    readonly otpVerifiedGraceSeconds: number;
    readonly otpResendCooldownSeconds: number;
    readonly otpRateLimitPerHour: number;
    readonly sessionTtlSeconds: number;
    readonly corsAllowedOrigins: readonly string[];
  };
}

// ── Contratos HTTP-agnósticos (reutilizados por Fastify y por Vercel) ─────
// El núcleo de cada endpoint se implementa como una función pura respecto al
// framework: recibe datos ya extraídos (body/query/ip) y devuelve status +
// body + headers. `registerRegistrationRoutes` (Fastify) y los handlers de
// `api/register/*.ts` (Vercel) son wrappers delgados sobre lo mismo — la
// regla de oro del repo ("nunca duplicar lógica entre superficies") vive
// aquí en vez de reescribirse en cada adaptador.

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface BodyRequest {
  readonly body: unknown;
}

interface SearchRequest {
  readonly query: unknown;
  readonly ip: string;
}

/** Cuerpo + IP: la disponibilidad va por POST pero se limita por IP. */
export interface IpBodyRequest extends BodyRequest {
  readonly ip: string;
}

export interface RegistrationHandlers {
  readonly otpTransports: () => Promise<HttpResponse>;
  readonly requestOtp: (req: BodyRequest) => Promise<HttpResponse>;
  readonly verifyOtp: (req: BodyRequest) => Promise<HttpResponse>;
  readonly farmsSearch: (req: SearchRequest) => Promise<HttpResponse>;
  readonly checkAvailability: (req: IpBodyRequest) => Promise<HttpResponse>;
  readonly register: (req: BodyRequest) => Promise<HttpResponse>;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): HttpResponse {
  return { status, body: { error: { code, message } }, headers };
}

// ── Validación (zod), espejando src/domain/farm/registration.ts ──────────

const otpTransportSchema = z.enum(['whatsapp', 'telegram', 'sms', 'email']);
const destinationKindSchema = z.enum(['phone', 'email']);

const requestOtpBodySchema = z.object({
  destination: z.string().min(1),
  destinationKind: destinationKindSchema,
  transport: otpTransportSchema,
});

const verifyOtpBodySchema = z.object({
  destination: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
});

/** Datos de OTP ya validados y normalizados, compartidos por registro y cuenta. */
export interface RequestOtpInput {
  readonly destination: string;
  readonly destinationKind: OtpDestinationKind;
  readonly transport: OtpTransport;
}

export interface VerifyOtpInput {
  readonly destination: string;
  readonly code: string;
}

const farmsSearchQuerySchema = z.object({
  q: z.string().trim().min(3),
});

const identificationTypeSchema = z.enum(['TI', 'CC', 'CE', 'PPT', 'PEP', 'PA']);

const userInputBodySchema = z.object({
  identificationType: identificationTypeSchema,
  identificationNumber: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
});

const farmInputBodySchema = z.object({
  name: z.string().min(1),
  legalType: z.enum(['natural', 'juridica']),
  taxIdType: z.enum(['cedula', 'nit']),
  taxId: z.string().min(1),
  location: z.string().min(1),
  // Rango/enteridad de las capacidades los valida el dominio
  // (`validateFarmInput`, isValidCapacity) con su propio mensaje en
  // español; aquí solo se exige el tipo JS correcto.
  cebaCapacity: z.number(),
  breedingCapacity: z.number(),
  totalCapacity: z.number(),
  sanitaryRegistry: z.string().min(1),
});

const workerInvitationBodySchema = z.object({
  displayName: z.string().min(1),
  identificationNumber: z.string().min(1),
  phone: z.string().min(1),
});

const registerBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('owner'),
    user: userInputBodySchema,
    farm: farmInputBodySchema,
    workers: z.array(workerInvitationBodySchema).optional(),
  }),
  z.object({
    kind: z.literal('worker'),
    user: userInputBodySchema,
    farmId: z.string().min(1),
  }),
]);

// ── Handlers ───────────────────────────────────────────────────────────

async function handleOtpTransports(deps: RegistrationHttpDeps): Promise<HttpResponse> {
  return { status: 200, body: { transports: deps.otpSender.availableTransports() } };
}

export function parseRequestOtpInput(rawBody: unknown): RequestOtpInput | undefined {
  const parsed = requestOtpBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return undefined;
  }
  const { destination, destinationKind, transport } = parsed.data;

  if (destinationKind === 'phone' && !isValidColombianMobile(destination)) {
    return undefined;
  }
  if (destinationKind === 'email' && !z.string().email().safeParse(destination).success) {
    return undefined;
  }

  return {
    destination: normalizeDestination(destination, destinationKind),
    destinationKind,
    transport,
  };
}

export function parseVerifyOtpInput(rawBody: unknown): VerifyOtpInput | undefined {
  const parsed = verifyOtpBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return undefined;
  }
  const destinationKind: OtpDestinationKind = parsed.data.destination.includes('@')
    ? 'email'
    : 'phone';
  return {
    destination: normalizeDestination(parsed.data.destination, destinationKind),
    code: parsed.data.code,
  };
}

export async function requestOtpResponse(
  deps: RegistrationHttpDeps,
  limiter: OtpRateLimiter,
  input: RequestOtpInput,
): Promise<HttpResponse> {
  // Cuota horaria por destino + cooldown de reenvío (spec 001 §4.2/§5).
  const limited = otpRateLimitResponse(limiter, input.destination);
  if (limited !== undefined) {
    return limited;
  }

  return sendOtpResponse(deps, input);
}

/** Aplica la cuota común; login usa una llave derivada del identificador. */
export function otpRateLimitResponse(
  limiter: OtpRateLimiter,
  key: string,
): HttpResponse | undefined {
  const decision = limiter.check(key);
  if (!decision.allowed) {
    return errorResponse(
      429,
      'rate_limited',
      'Ya pediste varios códigos seguidos, espera un momento antes de intentar de nuevo.',
      decision.retryAfterSeconds !== undefined
        ? { 'Retry-After': String(decision.retryAfterSeconds) }
        : undefined,
    );
  }
  return undefined;
}

/** Genera, persiste y envía un OTP una vez que ya pasó el rate limit. */
export async function sendOtpResponse(
  deps: RegistrationHttpDeps,
  input: RequestOtpInput,
): Promise<HttpResponse> {
  const { destination, destinationKind, transport } = input;
  if (!deps.otpSender.availableTransports().includes(transport)) {
    return errorResponse(
      503,
      'channel_not_configured',
      'Ese medio para recibir el código no está disponible ahora. Prueba con otro.',
    );
  }

  const code = generateOtpCode();
  // El código en claro solo vive en esta variable local para enviarlo por
  // el transporte elegido — nunca se loguea ni se devuelve en una respuesta.
  //
  // `codeHash` reutiliza `deps.hashUserId` (HMAC-SHA256 + USER_ID_SALT) en
  // vez de `hashOtpCode` + un pepper aparte: env.ts documenta que el pepper
  // del OTP ES `USER_ID_SALT` ("se guarda su HMAC con USER_ID_SALT como
  // pepper"), así que ambas funciones calculan exactamente el mismo hash
  // para el mismo secreto. Ampliar `RegistrationHttpDeps` con un segundo
  // pepper sería redundante.
  const codeHash = deps.hashUserId(code);

  const saved = await deps.otpStore.saveCode(
    { destination },
    {
      destinationKind,
      transport,
      codeHash,
      ttlSeconds: deps.config.otpTtlSeconds,
      maxAttempts: deps.config.otpMaxAttempts,
    },
  );
  if (!saved.ok) {
    return errorResponse(
      500,
      'persistence',
      'Tuvimos un problema generando tu código. Intenta de nuevo.',
    );
  }

  const sent = await deps.otpSender.sendCode(transport, destination, code);
  if (!sent.ok) {
    const status = sent.error.kind === 'channel_not_configured' ? 503 : 502;
    const message =
      sent.error.kind === 'channel_not_configured'
        ? 'Ese medio para recibir el código no está disponible ahora. Prueba con otro.'
        : 'No pudimos enviarte el código. Intenta de nuevo o elige otro medio.';
    return errorResponse(status, sent.error.kind, message);
  }

  return {
    status: 200,
    body: {
      ok: true,
      expiresInSeconds: deps.config.otpTtlSeconds,
      resendAfterSeconds: deps.config.otpResendCooldownSeconds,
    },
  };
}

async function handleRequestOtp(
  deps: RegistrationHttpDeps,
  limiter: OtpRateLimiter,
  rawBody: unknown,
): Promise<HttpResponse> {
  const input = parseRequestOtpInput(rawBody);
  if (input === undefined) {
    return errorResponse(400, 'validation', 'Revisa los datos del formulario.');
  }
  return requestOtpResponse(deps, limiter, input);
}

async function handleVerifyOtp(
  deps: RegistrationHttpDeps,
  rawBody: unknown,
): Promise<HttpResponse> {
  const input = parseVerifyOtpInput(rawBody);
  if (input === undefined) {
    return errorResponse(400, 'invalid_code', 'Revisa el código e inténtalo de nuevo.');
  }
  const { destination, code } = input;
  // El contrato de verify-otp (spec 001 §4.2) no incluye destinationKind: se
  // infiere del formato del propio destino (un correo siempre trae '@').
  const destinationKind: OtpDestinationKind = destination.includes('@') ? 'email' : 'phone';

  const status = await deps.otpStore.verifyCode({ destination }, code);
  switch (status) {
    case 'verified':
      return { status: 200, body: { ok: true, verified: true, destinationKind } };
    case 'invalid_code':
      return errorResponse(
        400,
        'invalid_code',
        'Ese código no es correcto. Revisa e inténtalo de nuevo.',
      );
    case 'expired':
      return errorResponse(410, 'expired_code', 'El código venció, solicita uno nuevo.');
    case 'too_many_attempts':
      return errorResponse(
        429,
        'too_many_attempts',
        'Intentaste demasiadas veces. Pide un código nuevo.',
      );
    case 'not_found':
      return errorResponse(
        404,
        'not_found',
        'No encontramos un código pendiente para ese destino. Solicita uno nuevo.',
      );
  }
}

async function handleFarmsSearch(
  deps: RegistrationHttpDeps,
  limiter: OtpRateLimiter,
  rawQuery: unknown,
  ip: string,
): Promise<HttpResponse> {
  const parsed = farmsSearchQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return errorResponse(400, 'validation', 'Escribe al menos 3 letras para buscar.');
  }

  // Búsqueda pública (spec 001, nota de privacidad final): rate limit por IP,
  // no por destino (no hay OTP de por medio en este endpoint).
  const decision = limiter.check(ip);
  if (!decision.allowed) {
    return errorResponse(
      429,
      'rate_limited',
      'Hiciste muchas búsquedas seguidas, espera un momento.',
      decision.retryAfterSeconds !== undefined
        ? { 'Retry-After': String(decision.retryAfterSeconds) }
        : undefined,
    );
  }

  const results = await deps.farmRepository.searchFarms(parsed.data.q, 5);
  return { status: 200, body: { results } };
}

const checkAvailabilityBodySchema = z.union([
  z.object({
    identificationType: identificationTypeSchema,
    identificationNumber: z.string().trim().min(1),
  }),
  z.object({ email: z.string().trim().email() }),
]);

/**
 * ¿Está libre esta identificación / este correo? Sirve para avisar en el
 * formulario antes de que la persona llene tres pasos y choque al final.
 *
 * Es POST y no GET a propósito: una cédula o un correo en el query string
 * queda en los registros de acceso del proxy. Y va con cuota por IP porque
 * responde sí/no sobre datos ajenos — es un oráculo de cuentas existentes
 * (compromiso aceptado explícitamente al priorizar el aviso temprano); la
 * cuota es lo que impide barrerlo a escala.
 */
async function handleCheckAvailability(
  deps: RegistrationHttpDeps,
  limiter: OtpRateLimiter,
  rawBody: unknown,
  ip: string,
): Promise<HttpResponse> {
  const parsed = checkAvailabilityBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse(400, 'validation', 'Revisa los datos del formulario.');
  }

  const decision = limiter.check(ip);
  if (!decision.allowed) {
    return errorResponse(
      429,
      'rate_limited',
      'Hiciste muchas consultas seguidas, espera un momento.',
      decision.retryAfterSeconds !== undefined
        ? { 'Retry-After': String(decision.retryAfterSeconds) }
        : undefined,
    );
  }

  const existing =
    'email' in parsed.data
      ? await deps.farmRepository.findUserByEmail(normalizeDestination(parsed.data.email, 'email'))
      : await deps.farmRepository.findUserByIdentification(
          parsed.data.identificationType,
          parsed.data.identificationNumber,
        );

  return { status: 200, body: { available: existing === null } };
}

async function handleRegister(deps: RegistrationHttpDeps, rawBody: unknown): Promise<HttpResponse> {
  const parsed = registerBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse(400, 'validation', 'Revisa los datos del formulario.');
  }
  const body = parsed.data;

  // `UserInput.channel` (domain/farm/registration.ts) solo tiene sentido
  // conceptual para los adaptadores de chat (WhatsApp/Telegram); ningún
  // caso de uso lo lee (no hay `.channel` en register-farm-and-user.ts) —
  // es dato inerte para este adaptador. El wizard web no tiene un "canal de
  // chat" real todavía, así que se fija un valor constante hasta que el
  // dominio agregue una variante propia (fuera de alcance de este corte).
  const WEB_CHANNEL_PLACEHOLDER = 'whatsapp' as const;

  const provisionalUser: UserInput = {
    identificationType: body.user.identificationType,
    identificationNumber: body.user.identificationNumber,
    phone: body.user.phone,
    // body.user.email sigue opcional en el schema HTTP (Tarea 4/8, fuera de
    // alcance aquí); '' hace que validateUserInput sea quien rechace con el
    // mensaje de dominio "Necesito tu correo electrónico." si falta.
    email: body.user.email ?? '',
    displayName: body.user.displayName,
    channel: WEB_CHANNEL_PLACEHOLDER,
    phoneVerified: false,
    emailVerified: false,
  };

  // Reutiliza la normalización/validación de dominio (mismo mensaje de error
  // que ve el resto del sistema, incluido el correo obligatorio) en vez de
  // duplicar las reglas de formato aquí.
  const userValidation = validateUserInput(provisionalUser);
  if (!userValidation.ok) {
    return errorResponse(
      400,
      'validation',
      userValidation.error.kind === 'validation'
        ? userValidation.error.message
        : 'Revisa los datos del formulario.',
    );
  }
  // El registro ya no exige verificación (decisión de producto: verificar
  // celular/correo es opcional y posterior). Nada queda "probado" aquí, así
  // que RegisterFarmAndUser no liga la identidad de chat: eso ocurre cuando la
  // persona le escribe al bot desde su celular (LinkChatIdentity) o cuando
  // verifica por OTP desde la web (VerifyAccountDestination).
  const finalUser: UserInput = { ...provisionalUser, phoneVerified: false, emailVerified: false };

  const input: RegisterFarmAndUserInput =
    body.kind === 'owner'
      ? { kind: 'owner', user: finalUser, farm: body.farm, workers: body.workers }
      : { kind: 'worker', user: finalUser, farmId: body.farmId };

  const outcome = await deps.registerFarmAndUser.submit(input);
  if (!outcome.ok) {
    return registrationErrorResponse(outcome.error);
  }

  const { user, farm, operator, membershipStatus } = outcome.value;
  const token = deps.sessionIssuer.issue(
    { userId: user.id, operatorId: operator.id, farmId: farm.id, role: operator.role },
    deps.config.sessionTtlSeconds,
  );

  return {
    status: 201,
    body: {
      ...(body.kind === 'owner' ? { farmId: farm.id } : {}),
      operatorId: operator.id,
      membershipStatus,
      session: { token, expiresInSeconds: deps.config.sessionTtlSeconds },
    },
  };
}

function registrationErrorResponse(error: RegistrationError): HttpResponse {
  switch (error.kind) {
    case 'duplicate_identification':
      return errorResponse(409, 'duplicate_identification', error.message);
    case 'duplicate_email':
      return errorResponse(409, 'duplicate_email', error.message);
    case 'duplicate_farm':
      return errorResponse(409, 'duplicate_farm', error.message);
    case 'already_member':
      return errorResponse(409, 'already_member', error.message);
    case 'farm_not_found':
      return errorResponse(404, 'farm_not_found', error.message);
    case 'validation':
      return errorResponse(400, 'validation', error.message);
    case 'persistence':
      return errorResponse(
        500,
        'persistence',
        'Tuvimos un problema guardando tu registro. Intenta de nuevo en un momento.',
      );
  }
}

/**
 * Construye los handlers HTTP-agnósticos una sola vez por proceso (los dos
 * `OtpRateLimiter` viven en closures aquí). Tanto `registerRegistrationRoutes`
 * (Fastify) como `getRegistrationHandlers` (`interfaces/serverless/runtime.ts`,
 * memoizado por instancia) llaman a esta función una única vez.
 */
export function createRegistrationHandlers(deps: RegistrationHttpDeps): RegistrationHandlers {
  const requestOtpLimiter = new OtpRateLimiter(
    {
      maxPerWindow: deps.config.otpRateLimitPerHour,
      windowSeconds: 3600,
      cooldownSeconds: deps.config.otpResendCooldownSeconds,
    },
    deps.clock,
  );
  // Cuota más holgada para la búsqueda pública de fincas: no hay reenvío que
  // espaciar (sin cooldown), solo un tope más alto de solicitudes/hora.
  const farmsSearchLimiter = new OtpRateLimiter(
    { maxPerWindow: deps.config.otpRateLimitPerHour * 10, windowSeconds: 3600 },
    deps.clock,
  );

  return {
    otpTransports: () => handleOtpTransports(deps),
    requestOtp: (req) => handleRequestOtp(deps, requestOtpLimiter, req.body),
    verifyOtp: (req) => handleVerifyOtp(deps, req.body),
    farmsSearch: (req) => handleFarmsSearch(deps, farmsSearchLimiter, req.query, req.ip),
    checkAvailability: (req) => handleCheckAvailability(deps, farmsSearchLimiter, req.body, req.ip),
    register: (req) => handleRegister(deps, req.body),
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

/**
 * Registra las rutas `/register/*` en el servidor Fastify local (spec 001
 * §4.2). El CORS con `@fastify/cors` se acota SOLO a estas rutas (nunca
 * global): se declara en un contexto de encapsulación propio y se espera
 * (`await`, las instancias de Fastify son "thenable") a que el plugin
 * termine de arrancar antes de declarar las rutas — los hooks que agrega un
 * plugin solo aplican a las rutas declaradas DESPUÉS de que arrancó dentro
 * de la misma encapsulación (mismo motivo por el que whatsapp-webhook.ts usa
 * `.after()` con fastify-raw-body). Si `corsAllowedOrigins` está vacío, no
 * se registra el plugin y las rutas quedan sin cabeceras CORS.
 */
export function registerRegistrationRoutes(app: FastifyInstance, deps: RegistrationHttpDeps): void {
  const handlers = createRegistrationHandlers(deps);

  app.register(async (scope) => {
    if (deps.config.corsAllowedOrigins.length > 0) {
      await scope.register(cors, {
        origin: [...deps.config.corsAllowedOrigins],
        methods: ['GET', 'POST', 'OPTIONS'],
      });
    }

    scope.get('/register/otp-transports', async (_request, reply) =>
      sendHttpResponse(reply, await handlers.otpTransports()),
    );
    scope.post('/register/request-otp', async (request, reply) =>
      sendHttpResponse(reply, await handlers.requestOtp({ body: request.body })),
    );
    scope.post('/register/verify-otp', async (request, reply) =>
      sendHttpResponse(reply, await handlers.verifyOtp({ body: request.body })),
    );
    scope.get('/register/farms/search', async (request, reply) =>
      sendHttpResponse(reply, await handlers.farmsSearch({ query: request.query, ip: request.ip })),
    );
    scope.post('/register/check-availability', async (request, reply) =>
      sendHttpResponse(
        reply,
        await handlers.checkAvailability({ body: request.body, ip: request.ip }),
      ),
    );
    scope.post('/register', async (request, reply) =>
      sendHttpResponse(reply, await handlers.register({ body: request.body })),
    );
  });
}
