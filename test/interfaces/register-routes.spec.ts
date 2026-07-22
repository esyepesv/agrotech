import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  registerRegistrationRoutes,
  type RegistrationHttpDeps,
} from '../../src/interfaces/http/register-routes.js';
import { RegisterFarmAndUser } from '../../src/application/use-cases/register-farm-and-user.js';
import type { RegisterFarmAndUserInput } from '../../src/domain/farm/registration.js';
import { FakeClock } from '../application/fakes/fake-clock.js';
import { FakeFarmRepository } from '../application/fakes/fake-farm-repository.js';
import { FakeOtpSender } from '../application/fakes/fake-otp-sender.js';
import { FakeOtpStore } from '../application/fakes/fake-otp-store.js';
import { FakeSessionIssuer } from '../application/fakes/fake-session-issuer.js';

const ALLOWED_ORIGIN = 'https://app.porcia.com.co';
const DISALLOWED_ORIGIN = 'https://evil.example.com';

// Formas de respuesta esperadas, usadas con `response.json<T>()` (soportado
// por light-my-request) en vez de `response.json()` a secas — evita el
// `any` implícito sin necesidad de castear ("sin any", CLAUDE.md).
interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}
interface OtpTransportsBody {
  readonly transports: readonly string[];
}
interface RequestOtpBody {
  readonly ok: true;
  readonly expiresInSeconds: number;
  readonly resendAfterSeconds: number;
}
interface VerifyOtpBody {
  readonly ok: true;
  readonly verified: true;
  readonly destinationKind: string;
}
interface FarmsSearchBody {
  readonly results: readonly {
    readonly id: string;
    readonly name: string;
    readonly location?: string;
  }[];
}
interface RegisterBody {
  readonly farmId?: string;
  readonly operatorId: string;
  readonly membershipStatus: string;
  readonly session: { readonly token: string; readonly expiresInSeconds: number };
}

// Sub-clase mínima para poder asertar EXACTAMENTE lo que recibió el caso de
// uso (spec 001 §4.3: "solo se verificó el correo → phoneVerified:false"),
// sin renunciar a que sea el caso de uso REAL el que procese el registro
// (RegisterFarmAndUser tiene un campo privado, así que un objeto literal no
// sería estructuralmente compatible con el tipo — heredar sí lo es).
class RecordingRegisterFarmAndUser extends RegisterFarmAndUser {
  lastInput: RegisterFarmAndUserInput | undefined;

  override async submit(input: RegisterFarmAndUserInput) {
    this.lastInput = input;
    return super.submit(input);
  }
}

function userInputBody(overrides: Record<string, unknown> = {}) {
  return {
    identificationType: 'CC',
    identificationNumber: '1032456789',
    phone: '3001234567',
    email: 'dueno@ejemplo.com',
    ...overrides,
  };
}

function farmInputBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'La Esperanza',
    legalType: 'natural',
    taxIdType: 'cedula',
    taxId: '1032456789',
    location: 'Vereda El Rosal, Cundinamarca',
    cebaCapacity: 100,
    breedingCapacity: 20,
    totalCapacity: 120,
    sanitaryRegistry: 'ICA-0001',
    ...overrides,
  };
}

function buildHarness(configOverrides: Partial<RegistrationHttpDeps['config']> = {}) {
  const clock = new FakeClock();
  const farmRepository = new FakeFarmRepository();
  const otpStore = new FakeOtpStore(clock);
  const otpSender = new FakeOtpSender();
  const sessionIssuer = new FakeSessionIssuer();
  let counter = 0;
  const idGenerator = () => `id-${(counter += 1)}`;
  const hashUserId = (raw: string) => `hash-${raw}`;

  const registerFarmAndUser = new RecordingRegisterFarmAndUser({
    farmRepository,
    clock,
    idGenerator,
    hashUserId,
  });

  const deps: RegistrationHttpDeps = {
    registerFarmAndUser,
    farmRepository,
    otpStore,
    otpSender,
    sessionIssuer,
    clock,
    hashUserId,
    config: {
      otpTtlSeconds: 300,
      otpMaxAttempts: 5,
      otpVerifiedGraceSeconds: 300,
      otpResendCooldownSeconds: 30,
      otpRateLimitPerHour: 3,
      sessionTtlSeconds: 604800,
      corsAllowedOrigins: [ALLOWED_ORIGIN],
      ...configOverrides,
    },
  };

  const app = Fastify();
  registerRegistrationRoutes(app, deps);

  return {
    app,
    deps,
    clock,
    farmRepository,
    otpStore,
    otpSender,
    sessionIssuer,
    registerFarmAndUser,
  };
}

/** Seed directo de una verificación vigente (spec 001 §4.3: isVerified). */
function seedVerified(
  otpStore: FakeOtpStore,
  clock: FakeClock,
  destination: string,
  destinationKind: 'phone' | 'email',
) {
  otpStore.entries.set(destination, {
    params: {
      destinationKind,
      transport: destinationKind === 'phone' ? 'sms' : 'email',
      codeHash: 'seed-hash',
      ttlSeconds: 300,
      maxAttempts: 5,
    },
    attempts: 0,
    expiresAt: new Date(clock.now().getTime() + 300_000),
    verifiedAt: clock.now(),
  });
}

/** Seed de un código pendiente de verificar (para probar verify-otp). */
function seedPending(
  otpStore: FakeOtpStore,
  clock: FakeClock,
  destination: string,
  opts: {
    codeHash: string;
    attempts?: number;
    maxAttempts?: number;
    expiresInSeconds?: number;
    destinationKind?: 'phone' | 'email';
  },
) {
  otpStore.entries.set(destination, {
    params: {
      destinationKind: opts.destinationKind ?? 'phone',
      transport: 'sms',
      codeHash: opts.codeHash,
      ttlSeconds: 300,
      maxAttempts: opts.maxAttempts ?? 5,
    },
    attempts: opts.attempts ?? 0,
    expiresAt: new Date(clock.now().getTime() + (opts.expiresInSeconds ?? 300) * 1000),
    verifiedAt: null,
  });
}

describe('registerRegistrationRoutes', () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
  });

  describe('GET /register/otp-transports', () => {
    it('camino feliz: devuelve los transportes disponibles', async () => {
      const response = await harness.app.inject({ method: 'GET', url: '/register/otp-transports' });
      expect(response.statusCode).toBe(200);
      expect(response.json<OtpTransportsBody>()).toEqual({
        transports: ['whatsapp', 'telegram', 'sms', 'email'],
      });
    });
  });

  describe('POST /register/request-otp', () => {
    it('camino feliz: genera y envía el código, nunca lo devuelve', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/register/request-otp',
        payload: { destination: '3001234567', destinationKind: 'phone', transport: 'sms' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<RequestOtpBody>();
      expect(body).toEqual({ ok: true, expiresInSeconds: 300, resendAfterSeconds: 30 });

      expect(harness.otpSender.sent).toHaveLength(1);
      const sent = harness.otpSender.sent[0]!;
      expect(sent.destination).toBe('+573001234567');
      expect(sent.code).toMatch(/^\d{6}$/);

      // El código en claro nunca aparece en la respuesta HTTP.
      expect(response.payload).not.toContain(sent.code);

      const stored = harness.otpStore.entries.get('+573001234567');
      expect(stored).toBeDefined();
      // Se guarda hasheado, no el código en claro.
      expect(stored?.params.codeHash).not.toBe(sent.code);
    });

    it('cuerpo inválido devuelve 400 validation', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/register/request-otp',
        payload: { destination: '', destinationKind: 'phone', transport: 'sms' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe('validation');
    });

    it('transporte no configurado devuelve 503 channel_not_configured', async () => {
      const h = buildHarness();
      h.otpSender.availableTransports = () => ['sms'];
      const response = await h.app.inject({
        method: 'POST',
        url: '/register/request-otp',
        payload: { destination: '3001234567', destinationKind: 'phone', transport: 'email' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json<ErrorBody>().error.code).toBe('channel_not_configured');
    });

    it('fallo de envío devuelve 502 send_failed', async () => {
      const failingSender = new FakeOtpSender(['whatsapp', 'telegram', 'sms', 'email'], {
        ok: false,
        error: { kind: 'send_failed', message: 'proveedor caído' },
      });
      const h = buildHarness();
      const app = Fastify();
      registerRegistrationRoutes(app, { ...h.deps, otpSender: failingSender });

      const response = await app.inject({
        method: 'POST',
        url: '/register/request-otp',
        payload: { destination: '3001234567', destinationKind: 'phone', transport: 'sms' },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json<ErrorBody>().error.code).toBe('send_failed');
    });

    it('rate limit (cooldown de reenvío) devuelve 429 rate_limited', async () => {
      const payload = { destination: '3001234567', destinationKind: 'phone', transport: 'sms' };
      const first = await harness.app.inject({
        method: 'POST',
        url: '/register/request-otp',
        payload,
      });
      expect(first.statusCode).toBe(200);

      // Sin avanzar el reloj: la segunda solicitud consecutiva al mismo
      // destino cae dentro del cooldown de reenvío.
      const second = await harness.app.inject({
        method: 'POST',
        url: '/register/request-otp',
        payload,
      });
      expect(second.statusCode).toBe(429);
      expect(second.json<ErrorBody>().error.code).toBe('rate_limited');
    });
  });

  describe('POST /register/verify-otp', () => {
    it('camino feliz: código correcto', async () => {
      seedPending(harness.otpStore, harness.clock, '+573001234567', { codeHash: '123456' });

      const response = await harness.app.inject({
        method: 'POST',
        url: '/register/verify-otp',
        payload: { destination: '3001234567', code: '123456' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<VerifyOtpBody>()).toEqual({
        ok: true,
        verified: true,
        destinationKind: 'phone',
      });
    });

    it('código incorrecto devuelve 400 invalid_code', async () => {
      seedPending(harness.otpStore, harness.clock, '+573001234567', { codeHash: '123456' });

      const response = await harness.app.inject({
        method: 'POST',
        url: '/register/verify-otp',
        payload: { destination: '3001234567', code: '000000' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe('invalid_code');
    });

    it('código vencido devuelve 410 expired_code', async () => {
      seedPending(harness.otpStore, harness.clock, '+573001234567', {
        codeHash: '123456',
        expiresInSeconds: -1,
      });

      const response = await harness.app.inject({
        method: 'POST',
        url: '/register/verify-otp',
        payload: { destination: '3001234567', code: '123456' },
      });
      expect(response.statusCode).toBe(410);
      expect(response.json<ErrorBody>().error.code).toBe('expired_code');
    });

    it('demasiados intentos devuelve 429 too_many_attempts', async () => {
      seedPending(harness.otpStore, harness.clock, '+573001234567', {
        codeHash: '123456',
        attempts: 5,
        maxAttempts: 5,
      });

      const response = await harness.app.inject({
        method: 'POST',
        url: '/register/verify-otp',
        payload: { destination: '3001234567', code: '123456' },
      });
      expect(response.statusCode).toBe(429);
      expect(response.json<ErrorBody>().error.code).toBe('too_many_attempts');
    });

    it('destino sin código pendiente devuelve 404 not_found', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/register/verify-otp',
        payload: { destination: '3009999999', code: '123456' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorBody>().error.code).toBe('not_found');
    });

    it('cuerpo inválido (código que no son 6 dígitos) devuelve 400', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/register/verify-otp',
        payload: { destination: '3001234567', code: 'abc' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /register/farms/search', () => {
    beforeEach(() => {
      harness.farmRepository.farmsById.set('farm-1', {
        id: 'farm-1',
        name: 'La Esperanza',
        location: 'Vereda El Rosal, Cundinamarca',
        config: { metaPartosPorAno: 2.5, region: 'CO' },
        createdAt: harness.clock.now(),
      });
    });

    it('camino feliz: devuelve hasta 5 resultados', async () => {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/register/farms/search?q=esp',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<FarmsSearchBody>()).toEqual({
        results: [
          { id: 'farm-1', name: 'La Esperanza', location: 'Vereda El Rosal, Cundinamarca' },
        ],
      });
    });

    it('q con menos de 3 caracteres devuelve 400 validation', async () => {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/register/farms/search?q=es',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe('validation');
    });

    it('rate limit por IP devuelve 429 rate_limited', async () => {
      const h = buildHarness({ otpRateLimitPerHour: 1 }); // cuota de búsqueda = 10/hora
      h.farmRepository.farmsById.set('farm-1', {
        id: 'farm-1',
        name: 'La Esperanza',
        config: { metaPartosPorAno: 2.5, region: 'CO' },
        createdAt: h.clock.now(),
      });

      let last;
      for (let i = 0; i < 11; i += 1) {
        last = await h.app.inject({ method: 'GET', url: '/register/farms/search?q=esp' });
      }
      expect(last?.statusCode).toBe(429);
      expect(last?.json<ErrorBody>().error.code).toBe('rate_limited');
    });
  });

  describe('POST /register', () => {
    it('camino feliz (dueño, celular verificado): 201 con sesión', async () => {
      seedVerified(harness.otpStore, harness.clock, '+573001234567', 'phone');

      const response = await harness.app.inject({
        method: 'POST',
        url: '/register',
        payload: { kind: 'owner', user: userInputBody(), farm: farmInputBody() },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<RegisterBody>();
      expect(body.operatorId).toBeDefined();
      expect(body.farmId).toBeDefined();
      expect(body.membershipStatus).toBe('activo');
      expect(body.session.token).toBeDefined();
      expect(body.session.expiresInSeconds).toBe(604800);

      // El destino verificado se consume: no queda reutilizable.
      expect(harness.otpStore.entries.has('+573001234567')).toBe(false);
    });

    it('sin verificación (ni celular ni correo) devuelve 412 phone_not_verified', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/register',
        payload: { kind: 'owner', user: userInputBody(), farm: farmInputBody() },
      });
      expect(response.statusCode).toBe(412);
      expect(response.json<ErrorBody>().error.code).toBe('phone_not_verified');
    });

    it('verificado SOLO por correo: registra, pero con phoneVerified:false para el caso de uso', async () => {
      seedVerified(harness.otpStore, harness.clock, 'duena@ejemplo.com', 'email');

      const response = await harness.app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          kind: 'owner',
          user: userInputBody({ email: 'Duena@Ejemplo.com' }),
          farm: farmInputBody(),
        },
      });

      expect(response.statusCode).toBe(201);
      expect(harness.registerFarmAndUser.lastInput?.user.phoneVerified).toBe(false);
      expect(harness.registerFarmAndUser.lastInput?.user.emailVerified).toBe(true);

      // Efecto observable de la regla de seguridad (spec 001 §4.3): la
      // identidad de chat NO queda ligada porque el celular no se probó.
      const body = response.json<{ operatorId: string }>();
      const operator = harness.farmRepository.operatorsById.get(body.operatorId);
      const user = operator ? harness.farmRepository.usersById.get(operator.userId) : undefined;
      expect(user?.channelUserHash).toBeUndefined();
      expect(user?.emailVerifiedAt).toBeDefined();
    });

    it('cuerpo inválido devuelve 400 validation', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/register',
        payload: { kind: 'owner', user: userInputBody(), farm: farmInputBody({ name: '' }) },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('CORS', () => {
    it('agrega cabeceras CORS para un origen permitido', async () => {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/register/otp-transports',
        headers: { origin: ALLOWED_ORIGIN },
      });
      expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    });

    it('no agrega cabeceras CORS para un origen no permitido', async () => {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/register/otp-transports',
        headers: { origin: DISALLOWED_ORIGIN },
      });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('no registra CORS en absoluto si la lista de orígenes está vacía', async () => {
      const h = buildHarness({ corsAllowedOrigins: [] });
      const response = await h.app.inject({
        method: 'GET',
        url: '/register/otp-transports',
        headers: { origin: ALLOWED_ORIGIN },
      });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
