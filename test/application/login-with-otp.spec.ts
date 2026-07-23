import { beforeEach, describe, expect, it } from 'vitest';
import { LoginWithOtp } from '../../src/application/use-cases/login-with-otp.js';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeFarmRepository } from './fakes/fake-farm-repository.js';
import { FakeOtpStore } from './fakes/fake-otp-store.js';
import { FakeSessionIssuer } from './fakes/fake-session-issuer.js';

describe('LoginWithOtp', () => {
  let repo: FakeFarmRepository;
  let otpStore: FakeOtpStore;
  let sessionIssuer: FakeSessionIssuer;
  let useCase: LoginWithOtp;

  beforeEach(async () => {
    const clock = new FakeClock();
    repo = new FakeFarmRepository();
    otpStore = new FakeOtpStore(clock);
    sessionIssuer = new FakeSessionIssuer();
    useCase = new LoginWithOtp({
      farmRepository: repo,
      otpStore,
      sessionIssuer,
      sessionTtlSeconds: 604800,
    });

    repo.seedRegistration(
      {
        id: 'u1',
        identificationType: 'CC',
        identificationNumber: '1032456789',
        phoneHash: 'h:+573001234567',
        email: 'juan@finca.co',
        createdAt: clock.now(),
      },
      {
        id: 'f1',
        name: 'La Esperanza',
        config: { metaPartosPorAno: 2.5, region: 'CO' },
        createdAt: clock.now(),
      },
      {
        id: 'o1',
        userId: 'u1',
        farmId: 'f1',
        role: 'administrador_dueno',
        status: 'activo',
      },
    );

    await otpStore.saveCode(
      { destination: 'juan@finca.co' },
      { destinationKind: 'email', transport: 'email', codeHash: '123456', ttlSeconds: 300, maxAttempts: 5 },
    );
  });

  it('no revela si la cédula existe', async () => {
    const outcome = await useCase.destinations({ identifier: '999999999' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.destinations.length).toBeGreaterThan(0);
      expect(outcome.value.destinations[0]?.masked).not.toContain('999999999');
    }
  });

  it('emite sesión con el código correcto', async () => {
    const outcome = await useCase.verify({ identifier: 'juan@finca.co', code: '123456' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.session.token).toBeTruthy();
      expect(outcome.value.farms).toEqual([
        { farmId: 'f1', farmName: 'La Esperanza', role: 'administrador_dueno' },
      ]);
    }
  });

  it('un trabajador con solicitud pendiente sí puede entrar (antes se le negaba como si el código estuviera mal)', async () => {
    const clock = new FakeClock();
    repo.seedRegistration(
      {
        id: 'u2',
        identificationType: 'CC',
        identificationNumber: '900111222',
        phoneHash: 'h:+573009998888',
        email: 'ana@finca.co',
        createdAt: clock.now(),
      },
      {
        id: 'f2',
        name: 'Villa Clara',
        config: { metaPartosPorAno: 2.5, region: 'CO' },
        createdAt: clock.now(),
      },
      { id: 'o2', userId: 'u2', farmId: 'f2', role: 'trabajador', status: 'pendiente' },
    );
    await otpStore.saveCode(
      { destination: 'ana@finca.co' },
      {
        destinationKind: 'email',
        transport: 'email',
        codeHash: '123456',
        ttlSeconds: 300,
        maxAttempts: 5,
      },
    );

    const outcome = await useCase.verify({ identifier: 'ana@finca.co', code: '123456' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.session.token).toBeTruthy();
    expect(outcome.value.farms).toEqual([
      { farmId: 'f2', farmName: 'Villa Clara', role: 'trabajador' },
    ]);
  });

  it('falla genérico con código correcto pero cuenta inexistente', async () => {
    const outcome = await useCase.verify({ identifier: 'nadie@finca.co', code: '123456' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('invalid_credentials');
    }
  });
});
