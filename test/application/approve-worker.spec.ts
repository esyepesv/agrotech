import { describe, expect, it } from 'vitest';
import type { AppUser } from '../../src/domain/farm/app-user.js';
import type { Farm } from '../../src/domain/farm/farm.js';
import type { Operator } from '../../src/domain/farm/operator.js';
import { ApproveWorker } from '../../src/application/use-cases/approve-worker.js';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeFarmRepository } from './fakes/fake-farm-repository.js';

const FARM_ID = 'farm-1';

function buildFarm(): Farm {
  return {
    id: FARM_ID,
    name: 'La Esperanza',
    config: { metaPartosPorAno: 2.5, region: 'CO' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function buildOwnerUser(): AppUser {
  return {
    id: 'user-owner',
    identificationType: 'CC',
    identificationNumber: '1032456789',
    phoneHash: 'phone-hash-owner',
    channelUserHash: 'hash-owner',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function buildOwnerOperator(): Operator {
  return {
    id: 'operator-owner',
    userId: 'user-owner',
    farmId: FARM_ID,
    role: 'administrador_dueno',
    status: 'activo',
  };
}

function buildWorkerUser(id = 'user-worker', identificationNumber = '900123456'): AppUser {
  return {
    id,
    identificationType: 'CC',
    identificationNumber,
    phoneHash: `phone-hash-${id}`,
    channelUserHash: `hash-${id}`,
    displayName: 'Juan Pérez',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function buildPendingOperator(
  id = 'operator-worker',
  userId = 'user-worker',
  pendingExpiresAt?: Date,
): Operator {
  return {
    id,
    userId,
    farmId: FARM_ID,
    role: 'trabajador',
    status: 'pendiente',
    pendingExpiresAt,
  };
}

function buildHarness() {
  const farmRepository = new FakeFarmRepository();
  const clock = new FakeClock();
  const useCase = new ApproveWorker({ farmRepository, clock });
  return { farmRepository, clock, useCase };
}

describe('ApproveWorker', () => {
  it('listPending devuelve las solicitudes pendientes de una granja', async () => {
    const h = buildHarness();
    h.farmRepository.seedRegistration(buildOwnerUser(), buildFarm(), buildOwnerOperator());
    h.farmRepository.seedRegistration(buildWorkerUser(), buildFarm(), buildPendingOperator());

    const pending = await h.useCase.listPending(FARM_ID);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.user.identificationNumber).toBe('900123456');
    expect(pending[0]?.farm.id).toBe(FARM_ID);
  });

  it('listPending descarta (perezosamente) las solicitudes vencidas (72h)', async () => {
    const h = buildHarness();
    h.farmRepository.seedRegistration(buildOwnerUser(), buildFarm(), buildOwnerOperator());
    const expired = new Date(h.clock.now().getTime() - 1000);
    h.farmRepository.seedRegistration(
      buildWorkerUser(),
      buildFarm(),
      buildPendingOperator('operator-worker', 'user-worker', expired),
    );

    const pending = await h.useCase.listPending(FARM_ID);

    expect(pending).toHaveLength(0);
  });

  it('aprobar (dueño activo): la membresía pasa a activo', async () => {
    const h = buildHarness();
    h.farmRepository.seedRegistration(buildOwnerUser(), buildFarm(), buildOwnerOperator());
    h.farmRepository.seedRegistration(buildWorkerUser(), buildFarm(), buildPendingOperator());

    const result = await h.useCase.resolve(buildOwnerOperator(), 'operator-worker', 'aprobar');

    expect(result.ok).toBe(true);
    const memberships = await h.farmRepository.findFarmsByUser('user-worker');
    expect(memberships[0]?.operator.status).toBe('activo');
  });

  it('rechazar: la membresía se elimina (el trabajador puede volver a solicitar)', async () => {
    const h = buildHarness();
    h.farmRepository.seedRegistration(buildOwnerUser(), buildFarm(), buildOwnerOperator());
    h.farmRepository.seedRegistration(buildWorkerUser(), buildFarm(), buildPendingOperator());

    const result = await h.useCase.resolve(buildOwnerOperator(), 'operator-worker', 'rechazar');

    expect(result.ok).toBe(true);
    const memberships = await h.farmRepository.findFarmsByUser('user-worker');
    expect(memberships).toHaveLength(0);
  });

  it('un trabajador (no administrador_dueno) no puede aprobar', async () => {
    const h = buildHarness();
    h.farmRepository.seedRegistration(buildOwnerUser(), buildFarm(), buildOwnerOperator());
    h.farmRepository.seedRegistration(buildWorkerUser(), buildFarm(), buildPendingOperator());
    const nonAdminApprover: Operator = {
      id: 'operator-other-worker',
      userId: 'user-other',
      farmId: FARM_ID,
      role: 'trabajador',
      status: 'activo',
    };

    const result = await h.useCase.resolve(nonAdminApprover, 'operator-worker', 'aprobar');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_authorized');
    const pending = await h.useCase.listPending(FARM_ID);
    expect(pending).toHaveLength(1);
  });

  it('un administrador_dueno con status pendiente (no activo aún) no puede aprobar', async () => {
    const h = buildHarness();
    h.farmRepository.seedRegistration(buildOwnerUser(), buildFarm(), buildOwnerOperator());
    h.farmRepository.seedRegistration(buildWorkerUser(), buildFarm(), buildPendingOperator());
    const pendingAdmin: Operator = {
      id: 'operator-pending-admin',
      userId: 'user-pending-admin',
      farmId: FARM_ID,
      role: 'administrador_dueno',
      status: 'pendiente',
    };

    const result = await h.useCase.resolve(pendingAdmin, 'operator-worker', 'aprobar');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_authorized');
  });

  it('solicitud inexistente → not_found', async () => {
    const h = buildHarness();
    h.farmRepository.seedRegistration(buildOwnerUser(), buildFarm(), buildOwnerOperator());

    const result = await h.useCase.resolve(
      buildOwnerOperator(),
      'operator-que-no-existe',
      'aprobar',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_found');
  });
});
