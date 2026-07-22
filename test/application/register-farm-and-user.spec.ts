import { describe, expect, it } from 'vitest';
import type {
  FarmInput,
  UserInput,
  WorkerInvitationInput,
} from '../../src/domain/farm/registration.js';
import {
  isValidCapacity,
  isValidColombianMobile,
  isValidIdentificationNumber,
  normalizeColombianMobileToE164,
} from '../../src/domain/farm/registration.js';
import { RegisterFarmAndUser } from '../../src/application/use-cases/register-farm-and-user.js';
import type { RegisterFarmAndUserDeps } from '../../src/application/use-cases/register-farm-and-user.js';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeFarmRepository } from './fakes/fake-farm-repository.js';

function userInput(overrides: Partial<UserInput> = {}): UserInput {
  return {
    identificationType: 'CC',
    identificationNumber: '1032456789',
    phone: '3001234567',
    channel: 'whatsapp',
    phoneVerified: true,
    emailVerified: false,
    ...overrides,
  };
}

function farmInput(overrides: Partial<FarmInput> = {}): FarmInput {
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

function workerInvitationInput(
  overrides: Partial<WorkerInvitationInput> = {},
): WorkerInvitationInput {
  return {
    displayName: 'Juan Pérez',
    identificationNumber: '900123456',
    phone: '3009876543',
    ...overrides,
  };
}

function buildHarness() {
  const farmRepository = new FakeFarmRepository();
  const clock = new FakeClock();
  let counter = 0;
  const idGenerator = () => `id-${(counter += 1)}`;
  const hashUserId = (raw: string) => `hash-${raw}`;
  const deps: RegisterFarmAndUserDeps = { farmRepository, clock, idGenerator, hashUserId };
  const useCase = new RegisterFarmAndUser(deps);
  return { farmRepository, clock, idGenerator, hashUserId, useCase };
}

describe('RegisterFarmAndUser', () => {
  it('alta feliz de dueño: crea AppUser + Farm + Operator (administrador_dueno, activo)', async () => {
    const h = buildHarness();

    const result = await h.useCase.submit({
      kind: 'owner',
      user: userInput(),
      farm: farmInput(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.membershipStatus).toBe('activo');
    expect(result.value.operator.role).toBe('administrador_dueno');
    expect(result.value.farm.name).toBe('La Esperanza');
    expect(result.value.user.identificationNumber).toBe('1032456789');
    // El celular normalizado a E.164 es la base del hash.
    expect(result.value.user.channelUserHash).toBe('hash-+573001234567');
  });

  it('registro por WhatsApp con el número del canal → hash escrito y phoneVerifiedAt puesto, sin OTP', async () => {
    const h = buildHarness();

    const result = await h.useCase.submit({
      kind: 'owner',
      user: userInput({ phoneVerified: true }),
      farm: farmInput(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.channelUserHash).toBe('hash-+573001234567');
    expect(result.value.user.phoneVerifiedAt).toEqual(h.clock.now());
  });

  it('celular declarado distinto y sin verificar → hash nulo (no se liga identidad de chat)', async () => {
    const h = buildHarness();

    const result = await h.useCase.submit({
      kind: 'owner',
      user: userInput({ phoneVerified: false, emailVerified: true, email: 'dueno@example.com' }),
      farm: farmInput(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.channelUserHash).toBeUndefined();
    expect(result.value.user.phoneVerifiedAt).toBeUndefined();
    expect(result.value.user.emailVerifiedAt).toEqual(h.clock.now());
  });

  it('multi-granja: misma persona (mismo hash) registra una segunda finca distinta', async () => {
    const h = buildHarness();
    const first = await h.useCase.submit({
      kind: 'owner',
      user: userInput(),
      farm: farmInput({ name: 'La Esperanza', taxId: '1032456789' }),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await h.useCase.submit({
      kind: 'owner',
      user: userInput(),
      farm: farmInput({ name: 'Villa Clara', taxId: '900999999' }),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.user.id).toBe(first.value.user.id);
    expect(second.value.farm.name).toBe('Villa Clara');
    const memberships = await h.farmRepository.findFarmsByUser(first.value.user.id);
    expect(memberships).toHaveLength(2);
  });

  it('persona existente sin hash (verificó solo correo) que luego verifica su celular: se completa la identidad, no se rechaza', async () => {
    const h = buildHarness();
    const first = await h.useCase.submit({
      kind: 'owner',
      user: userInput({ phoneVerified: false, emailVerified: true, email: 'dueno@example.com' }),
      farm: farmInput({ name: 'La Esperanza', taxId: '1032456789' }),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.user.channelUserHash).toBeUndefined();

    const second = await h.useCase.submit({
      kind: 'owner',
      user: userInput({ phoneVerified: true }),
      farm: farmInput({ name: 'Villa Clara', taxId: '900999999' }),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.user.id).toBe(first.value.user.id);
    expect(second.value.user.channelUserHash).toBe('hash-+573001234567');
  });

  it('duplicate_identification: misma identificación, celular (hash) distinto → se rechaza', async () => {
    const h = buildHarness();
    const first = await h.useCase.submit({
      kind: 'owner',
      user: userInput({ phone: '3001111111' }),
      farm: farmInput(),
    });
    expect(first.ok).toBe(true);

    const second = await h.useCase.submit({
      kind: 'owner',
      user: userInput({ phone: '3002222222' }),
      farm: farmInput({ name: 'Otra finca', taxId: '111222333' }),
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe('duplicate_identification');
  });

  it('duplicate_farm: misma persona registra la misma finca (mismo taxId + nombre) dos veces', async () => {
    const h = buildHarness();
    const first = await h.useCase.submit({
      kind: 'owner',
      user: userInput(),
      farm: farmInput({ name: 'La Esperanza', taxId: '1032456789' }),
    });
    expect(first.ok).toBe(true);

    const second = await h.useCase.submit({
      kind: 'owner',
      user: userInput(),
      farm: farmInput({ name: 'La Esperanza', taxId: '1032456789' }),
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe('duplicate_farm');
  });

  it('trabajador sin invitación previa → membresía pendiente', async () => {
    const h = buildHarness();
    const owner = await h.useCase.submit({ kind: 'owner', user: userInput(), farm: farmInput() });
    expect(owner.ok).toBe(true);
    if (!owner.ok) return;

    const result = await h.useCase.submit({
      kind: 'worker',
      user: userInput({ identificationNumber: '900123456', phone: '3009876543' }),
      farmId: owner.value.farm.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.membershipStatus).toBe('pendiente');
    expect(result.value.operator.role).toBe('trabajador');
    expect(result.value.operator.pendingExpiresAt).toBeDefined();
  });

  it('trabajador con invitación previa del dueño → membresía activa sin aprobación', async () => {
    const h = buildHarness();
    const owner = await h.useCase.submit({
      kind: 'owner',
      user: userInput(),
      farm: farmInput(),
      workers: [workerInvitationInput({ phone: '3009876543' })],
    });
    expect(owner.ok).toBe(true);
    if (!owner.ok) return;

    const result = await h.useCase.submit({
      kind: 'worker',
      user: userInput({ identificationNumber: '900123456', phone: '3009876543' }),
      farmId: owner.value.farm.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.membershipStatus).toBe('activo');
    expect(result.value.operator.pendingExpiresAt).toBeUndefined();
  });

  it('farm_not_found: trabajador intenta unirse a una finca inexistente', async () => {
    const h = buildHarness();

    const result = await h.useCase.submit({
      kind: 'worker',
      user: userInput(),
      farmId: 'finca-que-no-existe',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('farm_not_found');
  });

  it('already_member: trabajador que ya tiene membresía en esa finca no se duplica', async () => {
    const h = buildHarness();
    const owner = await h.useCase.submit({ kind: 'owner', user: userInput(), farm: farmInput() });
    expect(owner.ok).toBe(true);
    if (!owner.ok) return;

    const workerInput = {
      kind: 'worker' as const,
      user: userInput({ identificationNumber: '900123456', phone: '3009876543' }),
      farmId: owner.value.farm.id,
    };
    const first = await h.useCase.submit(workerInput);
    expect(first.ok).toBe(true);

    const second = await h.useCase.submit(workerInput);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe('already_member');
    if (second.error.kind === 'already_member') {
      expect(second.error.farmName).toBe('La Esperanza');
    }
  });

  it('validación: celular no colombiano → error de validación en el campo phone', async () => {
    const h = buildHarness();

    const result = await h.useCase.submit({
      kind: 'owner',
      user: userInput({ phone: '5551234567' }),
      farm: farmInput(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('validation');
    if (result.error.kind === 'validation') {
      expect(result.error.field).toBe('phone');
    }
  });

  it('validación: capacidad negativa → error de validación en el campo correspondiente', async () => {
    const h = buildHarness();

    const result = await h.useCase.submit({
      kind: 'owner',
      user: userInput(),
      farm: farmInput({ cebaCapacity: -1 }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('validation');
    if (result.error.kind === 'validation') {
      expect(result.error.field).toBe('cebaCapacity');
    }
  });

  it('validación: identificación vacía → error de validación', async () => {
    const h = buildHarness();

    const result = await h.useCase.submit({
      kind: 'owner',
      user: userInput({ identificationNumber: '   ' }),
      farm: farmInput(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('validation');
    if (result.error.kind === 'validation') {
      expect(result.error.field).toBe('identificationNumber');
    }
  });
});

describe('validación pura de registro (sin mocks)', () => {
  it('isValidColombianMobile acepta 10 dígitos que empiezan por 3, con o sin +57', () => {
    expect(isValidColombianMobile('3001234567')).toBe(true);
    expect(isValidColombianMobile('+573001234567')).toBe(true);
    expect(isValidColombianMobile('573001234567')).toBe(true);
  });

  it('isValidColombianMobile rechaza números que no empiezan por 3 o con longitud distinta', () => {
    expect(isValidColombianMobile('2001234567')).toBe(false);
    expect(isValidColombianMobile('300123456')).toBe(false);
    expect(isValidColombianMobile('30012345678')).toBe(false);
    expect(isValidColombianMobile('abc1234567')).toBe(false);
  });

  it('normalizeColombianMobileToE164 normaliza a +57 o retorna null si es inválido', () => {
    expect(normalizeColombianMobileToE164('3001234567')).toBe('+573001234567');
    expect(normalizeColombianMobileToE164('300 123 4567')).toBe('+573001234567');
    expect(normalizeColombianMobileToE164('2001234567')).toBeNull();
  });

  it('isValidCapacity exige entero mayor o igual a 0', () => {
    expect(isValidCapacity(0)).toBe(true);
    expect(isValidCapacity(120)).toBe(true);
    expect(isValidCapacity(-1)).toBe(false);
    expect(isValidCapacity(1.5)).toBe(false);
  });

  it('isValidIdentificationNumber exige no vacío tras recortar espacios', () => {
    expect(isValidIdentificationNumber('1032456789')).toBe(true);
    expect(isValidIdentificationNumber('   ')).toBe(false);
    expect(isValidIdentificationNumber('')).toBe(false);
  });
});
