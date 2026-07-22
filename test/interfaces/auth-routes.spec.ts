import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RegistrationHttpDeps } from '../../src/interfaces/http/register-routes.js';
import { registerAuthRoutes } from '../../src/interfaces/http/auth-routes.js';
import { RegisterFarmAndUser } from '../../src/application/use-cases/register-farm-and-user.js';
import { VerifyAccountDestination } from '../../src/application/use-cases/verify-account-destination.js';
import { LoginWithOtp } from '../../src/application/use-cases/login-with-otp.js';
import { FakeClock } from '../application/fakes/fake-clock.js';
import { FakeFarmRepository } from '../application/fakes/fake-farm-repository.js';
import { FakeOtpSender } from '../application/fakes/fake-otp-sender.js';
import { FakeOtpStore } from '../application/fakes/fake-otp-store.js';
import { FakeSessionIssuer } from '../application/fakes/fake-session-issuer.js';

interface ErrorBody {
  readonly error: { readonly code: string };
}

interface VerificationBody {
  readonly verified: true;
  readonly destinationKind: 'phone' | 'email';
}

const hashUserId = (raw: string): string => `h:${raw}`;

function buildHarness() {
  const clock = new FakeClock();
  const farmRepository = new FakeFarmRepository();
  const otpStore = new FakeOtpStore(clock);
  const sessionIssuer = new FakeSessionIssuer();
  const registration: RegistrationHttpDeps = {
    registerFarmAndUser: new RegisterFarmAndUser({
      farmRepository,
      clock,
      idGenerator: () => 'unused',
      hashUserId,
    }),
    farmRepository,
    otpStore,
    otpSender: new FakeOtpSender(),
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
      corsAllowedOrigins: ['https://app.porcia.com.co'],
    },
  };
  const verifyAccountDestination = new VerifyAccountDestination({
    farmRepository,
    otpStore,
    hashUserId,
    clock,
  });
  const loginWithOtp = new LoginWithOtp({
    farmRepository,
    otpStore,
    sessionIssuer,
    sessionTtlSeconds: 604800,
  });
  const app = Fastify();
  registerAuthRoutes(app, { registration, verifyAccountDestination, loginWithOtp });

  farmRepository.seedRegistration(
    {
      id: 'u1',
      identificationType: 'CC',
      identificationNumber: '1032456789',
      phoneHash: hashUserId('+573001234567'),
      email: 'juan@finca.co',
      createdAt: clock.now(),
    },
    {
      id: 'farm1',
      name: 'La Esperanza',
      config: { metaPartosPorAno: 2.5, region: 'CO' },
      createdAt: clock.now(),
    },
    {
      id: 'op1',
      userId: 'u1',
      farmId: 'farm1',
      role: 'administrador_dueno',
      status: 'activo',
    },
  );
  const token = sessionIssuer.issue(
    { userId: 'u1', operatorId: 'op1', farmId: 'farm1', role: 'dueño' },
    604800,
  );

  return { app, clock, farmRepository, otpStore, token };
}

describe('registerAuthRoutes', () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
  });

  it('exige una sesión válida para pedir un código de cuenta', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/account/request-otp',
      payload: { destination: 'juan@finca.co', destinationKind: 'email', transport: 'email' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('unauthorized');
  });

  it('no permite enviar un código a un destino de otra cuenta', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/account/request-otp',
      headers: { authorization: `Bearer ${harness.token}` },
      payload: { destination: 'otra@finca.co', destinationKind: 'email', transport: 'email' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('destination_mismatch');
  });

  it('verifica el correo de la cuenta autenticada', async () => {
    await harness.otpStore.saveCode(
      { destination: 'juan@finca.co' },
      { destinationKind: 'email', transport: 'email', codeHash: '123456', ttlSeconds: 300, maxAttempts: 5 },
    );
    const response = await harness.app.inject({
      method: 'POST',
      url: '/account/verify-otp',
      headers: { authorization: `Bearer ${harness.token}` },
      payload: { destination: 'juan@finca.co', code: '123456' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<VerificationBody>()).toEqual({ verified: true, destinationKind: 'email' });
    expect(harness.farmRepository.lastAttach?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('mantiene una respuesta uniforme al buscar destinos de login', async () => {
    const existing = await harness.app.inject({
      method: 'POST',
      url: '/auth/destinations',
      payload: { identifier: 'juan@finca.co' },
    });
    const missing = await harness.app.inject({
      method: 'POST',
      url: '/auth/destinations',
      payload: { identifier: 'nadie@finca.co' },
    });

    expect(existing.statusCode).toBe(200);
    expect(missing.statusCode).toBe(200);
    expect(existing.json<{ destinations: unknown[] }>().destinations).toHaveLength(1);
    expect(missing.json<{ destinations: unknown[] }>().destinations).toHaveLength(1);
  });
});
