import { beforeEach, describe, expect, it } from 'vitest';
import { RegisterFarmAndUserConversation } from '../../src/application/use-cases/register-farm-and-user-conversation.js';
import { RegisterFarmAndUser } from '../../src/application/use-cases/register-farm-and-user.js';
import { ApproveWorker } from '../../src/application/use-cases/approve-worker.js';
import type { OnboardingContext } from '../../src/application/use-cases/onboarding-conversation.js';
import type {
  RegistrationPartial,
  RegistrationStep,
} from '../../src/domain/farm/registration-conversation.js';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeFarmRepository } from './fakes/fake-farm-repository.js';
import { FakePendingEventStore } from './fakes/fake-pending-event-store.js';

const HASH = 'hash-canal';
const CTX: OnboardingContext = {
  channel: 'telegram',
  channelUserId: 'tg-123',
  inputWasVoice: false,
};

function buildHarness() {
  const clock = new FakeClock();
  const farmRepository = new FakeFarmRepository();
  const pendingEventStore = new FakePendingEventStore(clock);
  let counter = 0;
  const registerFarmAndUser = new RegisterFarmAndUser({
    farmRepository,
    clock,
    idGenerator: () => `id-${(counter += 1)}`,
    hashUserId: (raw) => `hash-${raw}`,
  });
  const conversation = new RegisterFarmAndUserConversation({
    registerFarmAndUser,
    approveWorker: new ApproveWorker({ farmRepository, clock }),
    farmRepository,
    pendingEventStore,
    clock,
  });
  return { conversation, pendingEventStore, farmRepository, clock, registerFarmAndUser };
}

type Harness = ReturnType<typeof buildHarness>;

/** Deja un borrador listo en el paso indicado, como si ya se hubiera avanzado. */
async function seedDraft(
  h: Harness,
  partial: RegistrationPartial,
  step: RegistrationStep,
): Promise<void> {
  await h.pendingEventStore.savePending(
    HASH,
    { kind: 'register_farm_and_user', partial, step },
    1800,
  );
}

function currentDraft(h: Harness): { partial: RegistrationPartial; step: string } | undefined {
  const pending = h.pendingEventStore.store.get(HASH)?.pending;
  if (pending === undefined || pending.kind !== 'register_farm_and_user') {
    return undefined;
  }
  return { partial: pending.partial, step: pending.step };
}

const FINCA_COMPLETA: RegistrationPartial = {
  role: 'administrador_dueno',
  phone: '+573001234567',
  farmName: 'La Esperanza',
  legalType: 'natural',
  taxId: '123456',
  location: 'Marinilla, Antioquia',
  cebaCapacity: 100,
  breedingCapacity: 10,
  totalCapacity: 110,
  sanitaryRegistry: 'ICA-0001',
  idType: 'CC',
  idNumber: '1032456789',
  email: 'juan@finca.co',
};

describe('RegisterFarmAndUserConversation — corregir, atrás y cancelar', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  it('escribir "cancelar" en el nombre de la finca NO lo guarda como nombre', async () => {
    await seedDraft(h, { role: 'administrador_dueno', phone: '+573001234567' }, 'farmName');

    const reply = await h.conversation.handle(HASH, 'cancelar', CTX);

    expect(reply.text).toContain('cancelar el registro');
    expect(currentDraft(h)?.step).toBe('cancelConfirm');
    expect(currentDraft(h)?.partial.farmName).toBeUndefined();
  });

  it('confirmar la cancelación descarta el borrador; decir que no, lo retoma', async () => {
    await seedDraft(h, { role: 'administrador_dueno', phone: '+573001234567' }, 'cancelConfirm');
    const cancelado = await h.conversation.handle(HASH, 'reg:cancelConfirm:yes', CTX);
    expect(cancelado.text).toContain('cancelé el registro');
    expect(currentDraft(h)).toBeUndefined();

    await seedDraft(h, { role: 'administrador_dueno', phone: '+573001234567' }, 'cancelConfirm');
    const sigue = await h.conversation.handle(HASH, 'reg:cancelConfirm:no', CTX);
    expect(sigue.text).toContain('finca');
    expect(currentDraft(h)?.step).toBe('farmName');
  });

  it('"atrás" vuelve a la pregunta anterior sin tocar el resto del borrador', async () => {
    await seedDraft(h, { ...FINCA_COMPLETA, location: undefined }, 'location');

    const reply = await h.conversation.handle(HASH, 'atrás', CTX);

    expect(reply.text).toContain('cédula');
    const draft = currentDraft(h);
    expect(draft?.step).toBe('taxId');
    expect(draft?.partial.taxId).toBeUndefined();
    expect(draft?.partial.farmName).toBe('La Esperanza');
  });

  it('"Corregir" en el resumen conserva las demás respuestas', async () => {
    await seedDraft(h, FINCA_COMPLETA, 'confirm');

    const pick = await h.conversation.handle(HASH, 'reg:confirm:correct', CTX);
    expect(pick.text).toContain('¿Qué dato quieres corregir?');
    expect(currentDraft(h)?.step).toBe('correctPick');

    const corrigiendo = await h.conversation.handle(HASH, 'reg:correctPick:farmName', CTX);
    expect(corrigiendo.text).toContain('¿Cómo se llama tu finca?');

    const draft = currentDraft(h);
    expect(draft?.partial.farmName).toBeUndefined();
    expect(draft?.partial.taxId).toBe('123456');
    expect(draft?.partial.email).toBe('juan@finca.co');
    expect(draft?.partial.totalCapacity).toBe(110);
  });

  it('tras corregir el dato, vuelve directo al resumen', async () => {
    await seedDraft(h, { ...FINCA_COMPLETA, farmName: undefined }, 'farmName');

    const reply = await h.conversation.handle(HASH, 'Villa Clara', CTX);

    expect(reply.text).toContain('¿Confirmo el registro?');
    expect(reply.text).toContain('Villa Clara');
    expect(currentDraft(h)?.step).toBe('confirm');
  });

  it('un choque de identificación conserva el borrador en vez de obligar a repetir todo', async () => {
    // Otra persona ya tiene esa identificación, con su celular probado.
    await h.registerFarmAndUser.submit({
      kind: 'owner',
      user: {
        identificationType: 'CC',
        identificationNumber: '1032456789',
        phone: '3009998888',
        channel: 'whatsapp',
        email: 'otra@finca.co',
        phoneVerified: true,
        emailVerified: false,
      },
      farm: {
        name: 'Finca ajena',
        legalType: 'natural',
        taxIdType: 'cedula',
        taxId: '999888',
        location: 'Otro lado',
        cebaCapacity: 10,
        breedingCapacity: 1,
        totalCapacity: 11,
        sanitaryRegistry: 'ICA-9999',
      },
    });

    await seedDraft(h, FINCA_COMPLETA, 'confirm');
    const reply = await h.conversation.handle(HASH, 'reg:confirm:confirm', CTX);

    expect(reply.text).toContain('Ya existe una cuenta con esa identificación');
    const draft = currentDraft(h);
    expect(draft).toBeDefined();
    expect(draft?.partial.farmName).toBe('La Esperanza');
  });
});
