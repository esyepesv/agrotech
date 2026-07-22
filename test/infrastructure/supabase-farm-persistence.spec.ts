import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Clock } from '../../src/application/ports/clock.js';
import type { Farm } from '../../src/domain/farm/farm.js';
import type { Operator } from '../../src/domain/farm/operator.js';
import type { PendingDraft } from '../../src/domain/farm/pending-draft.js';
import { SupabaseFarmRepository } from '../../src/infrastructure/persistence/supabase-farm-repository.js';
import { SupabasePendingEventStore } from '../../src/infrastructure/persistence/supabase-pending-event-store.js';

const hasSupabaseCreds =
  Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_KEY);

// Migración 0003_farm_module.sql está "PENDIENTE DE APLICAR" (B1 de
// PLAN-v1.1.md): puede haber credenciales de Supabase pero aún no la tabla
// `farm`. Se sondea una vez antes de decidir si la suite corre, en vez de
// fallar con un error de "relation does not exist" en cada test (mismo
// espíritu que el fail-open documentado en supabase-message-deduplicator.ts
// para la migración 0002).
let farmTableReady = false;
if (hasSupabaseCreds) {
  const probeClient = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  );
  const probe = await probeClient.from('farm').select('id').limit(1);
  farmTableReady = probe.error === null;
}

const systemClock: Clock = { now: () => new Date() };

// El cliente se construye de forma perezosa (memoizada), nunca en el cuerpo
// directo del describe: ese cuerpo se ejecuta siempre durante la
// recolección de tests, incluso si describe.skipIf() termina saltando su
// ejecución, y construir el cliente ahí reventaría por falta de
// SUPABASE_URL/SUPABASE_SERVICE_KEY aun estando "saltado" (mismo espíritu
// que llm-answer-generator.spec.ts, que construye su cliente dentro de
// cada `it()`).
let cachedClient: SupabaseClient | undefined;
function getClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_KEY ?? '',
      { auth: { persistSession: false } },
    );
  }
  return cachedClient;
}

describe.skipIf(!hasSupabaseCreds || !farmTableReady)(
  'SupabaseFarmRepository / SupabasePendingEventStore (integración real)',
  () => {
    const createdFarmIds: string[] = [];
    const createdOperatorIds: string[] = [];
    const createdPendingHashes: string[] = [];

    afterAll(async () => {
      // Limpieza defensiva: si algún assert falla a mitad de un test, igual
      // se intenta borrar lo creado (datos sintéticos con prefijo test-).
      // No construye cliente si no hay nada que limpiar (p. ej. si la suite
      // fue saltada y ningún `it()` llegó a correr).
      if (
        createdFarmIds.length === 0 &&
        createdOperatorIds.length === 0 &&
        createdPendingHashes.length === 0
      ) {
        return;
      }
      const client = getClient();
      if (createdOperatorIds.length > 0) {
        await client.from('operator').delete().in('id', createdOperatorIds);
      }
      if (createdFarmIds.length > 0) {
        await client.from('farm').delete().in('id', createdFarmIds);
      }
      if (createdPendingHashes.length > 0) {
        await client.from('pending_event').delete().in('operator_hash', createdPendingHashes);
      }
    });

    it('saveFarm + saveOperator + findOperatorByHash hacen un round-trip completo', async () => {
      const farmRepository = new SupabaseFarmRepository(getClient());
      const farmId = randomUUID();
      const channelUserHash = `test-hash-${randomUUID()}`;
      createdFarmIds.push(farmId);

      const farm: Farm = {
        id: farmId,
        name: 'test-granja-integracion',
        ownerName: 'test-owner',
        config: { metaPartosPorAno: 2.5, region: 'CO' },
        createdAt: new Date(),
      };
      const savedFarm = await farmRepository.saveFarm(farm);
      expect(savedFarm.ok).toBe(true);

      const operatorId = randomUUID();
      createdOperatorIds.push(operatorId);
      const operator: Operator = {
        id: operatorId,
        userId: randomUUID(),
        farmId,
        channelUserHash,
        displayName: 'test-operario',
        role: 'administrador_dueno',
        status: 'activo',
      };
      const savedOperator = await farmRepository.saveOperator(operator);
      expect(savedOperator.ok).toBe(true);

      const found = await farmRepository.findOperatorByHash(channelUserHash);
      expect(found).not.toBeNull();
      expect(found?.operator.id).toBe(operatorId);
      expect(found?.operator.farmId).toBe(farmId);
      expect(found?.farm.id).toBe(farmId);
      expect(found?.farm.name).toBe('test-granja-integracion');
    });

    it('hash desconocido → findOperatorByHash devuelve null', async () => {
      const farmRepository = new SupabaseFarmRepository(getClient());
      const found = await farmRepository.findOperatorByHash(
        `test-hash-inexistente-${randomUUID()}`,
      );
      expect(found).toBeNull();
    });

    it('savePending + takePending hacen un round-trip; una segunda toma devuelve null', async () => {
      const pendingEventStore = new SupabasePendingEventStore(getClient(), systemClock);
      const operatorHash = `test-pending-hash-${randomUUID()}`;
      createdPendingHashes.push(operatorHash);
      const draft: PendingDraft = {
        kind: 'register_entity',
        entity: { entity: 'sow', chapeta: 'test-214' },
      };

      const saved = await pendingEventStore.savePending(operatorHash, draft, 60);
      expect(saved.ok).toBe(true);

      const taken = await pendingEventStore.takePending(operatorHash);
      expect(taken).toEqual(draft);

      const takenAgain = await pendingEventStore.takePending(operatorHash);
      expect(takenAgain).toBeNull();
    });
  },
);
