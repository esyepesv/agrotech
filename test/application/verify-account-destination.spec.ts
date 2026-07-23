import { beforeEach, describe, expect, it } from 'vitest';
import { VerifyAccountDestination } from '../../src/application/use-cases/verify-account-destination.js';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeFarmRepository } from './fakes/fake-farm-repository.js';
import { FakeOtpStore } from './fakes/fake-otp-store.js';

const hashUserId = (raw: string): string => `h:${raw}`;

describe('VerifyAccountDestination', () => {
  let repo: FakeFarmRepository;
  let otpStore: FakeOtpStore;
  let clock: FakeClock;
  let useCase: VerifyAccountDestination;

  beforeEach(async () => {
    clock = new FakeClock();
    repo = new FakeFarmRepository();
    otpStore = new FakeOtpStore(clock);
    useCase = new VerifyAccountDestination({ farmRepository: repo, otpStore, hashUserId, clock });

    repo.usersById.set('u1', {
      id: 'u1',
      identificationType: 'CC',
      identificationNumber: '1032456789',
      phoneHash: hashUserId('+573001234567'),
      email: 'juan@finca.co',
      createdAt: clock.now(),
    });

    await otpStore.saveCode(
      { destination: '+573001234567' },
      {
        destinationKind: 'phone',
        transport: 'whatsapp',
        codeHash: '123456',
        ttlSeconds: 300,
        maxAttempts: 5,
      },
    );
    await otpStore.saveCode(
      { destination: 'juan@finca.co' },
      {
        destinationKind: 'email',
        transport: 'email',
        codeHash: '123456',
        ttlSeconds: 300,
        maxAttempts: 5,
      },
    );
  });

  it('verificar el celular liga la identidad de chat', async () => {
    const outcome = await useCase.verify({
      userId: 'u1',
      destination: '+573001234567',
      code: '123456',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.destinationKind).toBe('phone');
    }
    expect(repo.lastAttach).toEqual({
      userId: 'u1',
      channelUserHash: 'h:+573001234567',
      phoneVerifiedAt: expect.any(Date) as Date,
    });
  });

  it('verificar el correo NO liga identidad de chat', async () => {
    const outcome = await useCase.verify({
      userId: 'u1',
      destination: 'juan@finca.co',
      code: '123456',
    });
    expect(outcome.ok).toBe(true);
    expect(repo.lastAttach?.channelUserHash).toBeUndefined();
    expect(repo.lastAttach?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rechaza un destino que no es de la cuenta', async () => {
    const outcome = await useCase.verify({
      userId: 'u1',
      destination: '+573009999999',
      code: '123456',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('destination_mismatch');
    }
    // No se debe consultar/gastar intentos del OTP de un destino ajeno.
    expect(repo.lastAttach).toBeUndefined();
  });

  it('rechaza un código incorrecto', async () => {
    const outcome = await useCase.verify({
      userId: 'u1',
      destination: '+573001234567',
      code: '000000',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('invalid_code');
    }
  });

  it('rechaza un userId sin cuenta', async () => {
    const outcome = await useCase.verify({
      userId: 'no-existe',
      destination: '+573001234567',
      code: '123456',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('destination_mismatch');
    }
  });
});
