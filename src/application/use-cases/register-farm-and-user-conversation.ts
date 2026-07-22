import type { RegistrationStep } from '../../domain/farm/registration-conversation.js';
import {
  applyAnswer,
  nextStep,
  optionsForStep,
  promptFor,
  type RegistrationPartial,
  type RegistrationPrompt,
} from '../../domain/farm/registration-conversation.js';
import type { RegistrationError } from '../../domain/farm/registration.js';
import type { RegisterFarmAndUserInput } from '../../domain/farm/registration.js';
import { parseOptionId } from '../../domain/message/reply-option.js';
import type { Clock } from '../ports/clock.js';
import type { FarmRepository } from '../ports/farm-repository.js';
import type { PendingEventStore } from '../ports/pending-event-store.js';
import type { ApproveWorker } from './approve-worker.js';
import type { FarmReply } from './farm-reply.js';
import type { OnboardingContext, OnboardingConversation } from './onboarding-conversation.js';
import type { RegisterFarmAndUser, RegistrationOutcome } from './register-farm-and-user.js';

export interface RegisterFarmAndUserConversationDeps {
  readonly registerFarmAndUser: RegisterFarmAndUser;
  readonly approveWorker: ApproveWorker;
  readonly farmRepository: FarmRepository;
  readonly pendingEventStore: PendingEventStore;
  readonly clock: Clock;
  // TTL propio de onboarding (spec 001 §4.1 punto 6): default 1800s
  // (ONBOARDING_PENDING_TTL_SECONDS), distinto del TTL de 600s de LogFarmEvent.
  readonly pendingTtlSeconds?: number;
}

const DEFAULT_PENDING_TTL_SECONDS = 1800;
const MAX_OPTION_ATTEMPTS = 3;

const OBSOLETE_OPTION_MESSAGE = 'Esa opción ya no aplica.';
const CONTINUE_ON_WEB_MESSAGE =
  'No logramos entendernos por aquí. Si prefieres, puedes completar tu registro desde la página web.';
const CANCELLED_MESSAGE =
  'Listo, cancelé el registro. Escríbeme cuando quieras intentarlo de nuevo.';
const NO_FARMS_FOUND_MESSAGE =
  'No encontramos fincas con ese nombre. Verifica con tu administrador el nombre exacto.';
const NO_ANOTHER_FARM_MESSAGE = '¡Listo! Si necesitas algo más, aquí estoy.';
const GENERIC_RETRY_MESSAGE =
  'Tuvimos un problema guardando tu registro. Intenta de nuevo en un momento.';
const ALREADY_REGISTERED_WORKER_MESSAGE =
  'Ya estás registrado. Escríbeme "compré..." o "¿cuánto me queda?" para llevar tus registros.';

/**
 * Adaptador conversacional multi-turno del registro (spec 001 §4.1): pregunta
 * campo a campo usando la máquina pura de `registration-conversation.ts`,
 * guarda el progreso en `PendingEventStore` (variante `register_farm_and_user`
 * de `PendingDraft`) bajo el hash de canal, y solo al confirmar llama a
 * `RegisterFarmAndUser.submit()`. Reemplaza a `RegisterFarm` en el cableado
 * de onboarding (arquitectura-v1.2.md §7).
 */
export class RegisterFarmAndUserConversation implements OnboardingConversation {
  private readonly pendingTtlSeconds: number;

  constructor(private readonly deps: RegisterFarmAndUserConversationDeps) {
    this.pendingTtlSeconds = deps.pendingTtlSeconds ?? DEFAULT_PENDING_TTL_SECONDS;
  }

  async handle(channelUserHash: string, text: string, ctx: OnboardingContext): Promise<FarmReply> {
    const draft = await this.loadDraft(channelUserHash);
    if (draft !== null) {
      return this.continueDraft(channelUserHash, draft.partial, draft.step, text, ctx);
    }
    return this.startFresh(channelUserHash, ctx);
  }

  // ── Arranque ─────────────────────────────────────────────────────────

  private async startFresh(channelUserHash: string, ctx: OnboardingContext): Promise<FarmReply> {
    const approvalPrompt = await this.maybeStartApproval(channelUserHash, ctx);
    if (approvalPrompt !== null) {
      return approvalPrompt;
    }

    const existingUser = await this.deps.farmRepository.findUserByHash(channelUserHash);
    if (existingUser !== null) {
      const memberships = await this.deps.farmRepository.findFarmsByUser(existingUser.id);
      const isOwner = memberships.some((m) => m.operator.role === 'administrador_dueno');
      if (!isOwner) {
        return { text: ALREADY_REGISTERED_WORKER_MESSAGE };
      }
      const partial: RegistrationPartial = { role: 'administrador_dueno' };
      return this.advance(channelUserHash, partial, ctx, 'anotherFarmPrompt');
    }

    return this.advance(channelUserHash, {}, ctx);
  }

  private async maybeStartApproval(
    channelUserHash: string,
    ctx: OnboardingContext,
  ): Promise<FarmReply | null> {
    const approverWithFarm = await this.deps.farmRepository.findOperatorByHash(channelUserHash);
    if (
      approverWithFarm === null ||
      approverWithFarm.operator.role !== 'administrador_dueno' ||
      approverWithFarm.operator.status !== 'activo'
    ) {
      return null;
    }
    const pending = await this.deps.approveWorker.listPending(approverWithFarm.farm.id);
    const next = pending[0];
    if (next === undefined) {
      return null;
    }
    const partial: RegistrationPartial = {
      role: 'administrador_dueno',
      pendingApproval: {
        operatorId: next.operator.id,
        farmId: next.farm.id,
        farmName: next.farm.name,
        identificationNumber: next.user.identificationNumber,
        displayName: next.user.displayName,
      },
    };
    return this.advance(channelUserHash, partial, ctx, 'approveWorker');
  }

  // ── Continuación de un borrador existente ───────────────────────────────

  private async continueDraft(
    channelUserHash: string,
    partial: RegistrationPartial,
    step: RegistrationStep,
    text: string,
    ctx: OnboardingContext,
  ): Promise<FarmReply> {
    const parsedOption = parseOptionId(text);
    if (parsedOption !== undefined && parsedOption.field !== step) {
      // Botón obsoleto (§5): no se sobreescribe nada, se reenvía el paso vigente.
      await this.saveDraft(channelUserHash, partial, step);
      return prefixReply(OBSOLETE_OPTION_MESSAGE, promptFor(step, partial, promptCtx(ctx)));
    }

    switch (step) {
      case 'approveWorker':
        return this.handleApproveWorkerStep(channelUserHash, partial, text, ctx);
      case 'anotherFarmPrompt':
        return this.handleAnotherFarmStep(channelUserHash, partial, text, ctx);
      case 'confirm':
        return this.handleConfirmStep(channelUserHash, partial, text, ctx);
      default:
        return this.handleFieldStep(channelUserHash, partial, step, text, ctx);
    }
  }

  private async handleFieldStep(
    channelUserHash: string,
    partial: RegistrationPartial,
    step: RegistrationStep,
    text: string,
    ctx: OnboardingContext,
  ): Promise<FarmReply> {
    // Detección del celular (§4.1.2): si el adaptador YA trae un número
    // probado por el canal, se acepta sin pasar por applyAnswer ni pedir nada.
    if (step === 'phone' && ctx.detectedPhone !== undefined) {
      const updated: RegistrationPartial = {
        ...partial,
        phone: ctx.detectedPhone,
        phoneVerified: true,
        failedAttempts: 0,
      };
      return this.advance(channelUserHash, updated, ctx);
    }

    const applied = applyAnswer(partial, step, text, { inputWasVoice: ctx.inputWasVoice });
    if (!applied.ok) {
      return this.handleStepError(channelUserHash, partial, step, applied.error, ctx);
    }

    let updated: RegistrationPartial = { ...applied.value, failedAttempts: 0 };
    if (step === 'phone') {
      // Un número tecleado nunca se da por verificado (§4.1.2): solo el
      // canal (WhatsApp siempre, Telegram vía contacto compartido) verifica.
      updated = { ...updated, phoneVerified: false };
    }

    if (step === 'workerFarmSearch') {
      return this.handleFarmSearch(channelUserHash, updated, ctx);
    }

    return this.advance(channelUserHash, updated, ctx);
  }

  private async handleStepError(
    channelUserHash: string,
    partial: RegistrationPartial,
    step: RegistrationStep,
    error: { readonly message: string; readonly resetToStep?: RegistrationStep },
    ctx: OnboardingContext,
  ): Promise<FarmReply> {
    const hasOptions = optionsForStep(step, partial) !== undefined;
    const attempts = (partial.failedAttempts ?? 0) + 1;

    if (hasOptions && attempts >= MAX_OPTION_ATTEMPTS) {
      const reset = { ...partial, failedAttempts: 0 };
      await this.saveDraft(channelUserHash, reset, step);
      return { text: `${error.message} ${CONTINUE_ON_WEB_MESSAGE}` };
    }

    const withAttempts = { ...partial, failedAttempts: attempts };
    const promptStep = error.resetToStep ?? step;
    await this.saveDraft(channelUserHash, withAttempts, promptStep);
    return prefixReply(error.message, promptFor(promptStep, withAttempts, promptCtx(ctx)));
  }

  private async handleFarmSearch(
    channelUserHash: string,
    partial: RegistrationPartial,
    ctx: OnboardingContext,
  ): Promise<FarmReply> {
    const results = await this.deps.farmRepository.searchFarms(partial.workerFarmQuery ?? '', 5);
    if (results.length === 0) {
      const reset: RegistrationPartial = { ...partial, workerFarmQuery: undefined };
      await this.saveDraft(channelUserHash, reset, 'workerFarmSearch');
      return { text: NO_FARMS_FOUND_MESSAGE };
    }
    const withResults: RegistrationPartial = {
      ...partial,
      workerFarmResults: results.map((r) => ({ id: r.id, name: r.name, location: r.location })),
    };
    return this.advance(channelUserHash, withResults, ctx);
  }

  private async handleAnotherFarmStep(
    channelUserHash: string,
    partial: RegistrationPartial,
    text: string,
    ctx: OnboardingContext,
  ): Promise<FarmReply> {
    const applied = applyAnswer(partial, 'anotherFarmPrompt', text, {
      inputWasVoice: ctx.inputWasVoice,
    });
    if (!applied.ok) {
      return this.handleStepError(
        channelUserHash,
        partial,
        'anotherFarmPrompt',
        applied.error,
        ctx,
      );
    }
    if (applied.value.anotherFarmDecision === 'no') {
      return { text: NO_ANOTHER_FARM_MESSAGE };
    }

    const existingUser = await this.deps.farmRepository.findUserByHash(channelUserHash);
    if (existingUser === null) {
      return { text: GENERIC_RETRY_MESSAGE };
    }
    const fresh: RegistrationPartial = {
      role: 'administrador_dueno',
      existingUserId: existingUser.id,
      idType: existingUser.identificationType,
      idNumber: existingUser.identificationNumber,
      phone: ctx.detectedPhone,
      phoneVerified: ctx.detectedPhone !== undefined,
      email: existingUser.email,
      emailChoice: existingUser.email !== undefined ? 'write' : 'skip',
    };
    return this.advance(channelUserHash, fresh, ctx);
  }

  private async handleApproveWorkerStep(
    channelUserHash: string,
    partial: RegistrationPartial,
    text: string,
    ctx: OnboardingContext,
  ): Promise<FarmReply> {
    const applied = applyAnswer(partial, 'approveWorker', text, {
      inputWasVoice: ctx.inputWasVoice,
    });
    if (!applied.ok) {
      return this.handleStepError(channelUserHash, partial, 'approveWorker', applied.error, ctx);
    }
    const decision = applied.value.pendingApprovalDecision;
    const pendingApproval = partial.pendingApproval;
    if (decision === undefined || pendingApproval === undefined) {
      return { text: GENERIC_RETRY_MESSAGE };
    }
    const approverWithFarm = await this.deps.farmRepository.findOperatorByHash(channelUserHash);
    if (approverWithFarm === null) {
      return { text: GENERIC_RETRY_MESSAGE };
    }
    const result = await this.deps.approveWorker.resolve(
      approverWithFarm.operator,
      pendingApproval.operatorId,
      decision,
    );
    if (!result.ok) {
      return { text: result.error.message };
    }
    const who = pendingApproval.displayName ?? 'la persona';
    const message =
      decision === 'aprobar'
        ? `Listo, aprobé a ${who} en ${pendingApproval.farmName}.`
        : `Listo, rechacé la solicitud de ${who}.`;
    return { text: message };
  }

  private async handleConfirmStep(
    channelUserHash: string,
    partial: RegistrationPartial,
    text: string,
    ctx: OnboardingContext,
  ): Promise<FarmReply> {
    const applied = applyAnswer(partial, 'confirm', text, { inputWasVoice: ctx.inputWasVoice });
    if (!applied.ok) {
      return this.handleStepError(channelUserHash, partial, 'confirm', applied.error, ctx);
    }

    const decided = applied.value;
    if (decided.confirmDecision === 'cancel') {
      return { text: CANCELLED_MESSAGE };
    }
    if (decided.confirmDecision === 'correct') {
      return this.advance(channelUserHash, {}, ctx, 'role');
    }

    const input = buildRegisterInput(decided, ctx);
    if (input === undefined) {
      return this.advance(channelUserHash, {}, ctx, 'role');
    }

    const result = await this.deps.registerFarmAndUser.submit(input);
    if (!result.ok) {
      return this.handleRegistrationError(channelUserHash, decided, result.error, ctx);
    }
    return { text: successMessage(result.value, decided) };
  }

  private async handleRegistrationError(
    channelUserHash: string,
    partial: RegistrationPartial,
    error: RegistrationError,
    ctx: OnboardingContext,
  ): Promise<FarmReply> {
    switch (error.kind) {
      case 'duplicate_identification':
        return { text: `${error.message} Si crees que es un error, contacta a soporte.` };
      case 'duplicate_farm':
        return {
          text: `${error.message} Escríbeme "registrarme" si quieres dar de alta una finca distinta.`,
        };
      case 'already_member':
        return { text: `${error.message} (${error.farmName})` };
      case 'farm_not_found':
        return { text: `${error.message} Escríbeme "registrarme" para buscar de nuevo.` };
      case 'validation': {
        await this.saveDraft(channelUserHash, partial, 'confirm');
        return { text: `${error.message} Escribe "corregir" para reiniciar el registro.` };
      }
      case 'persistence': {
        await this.saveDraft(channelUserHash, partial, 'confirm');
        void ctx; // el reintento reutiliza el mismo ctx en el próximo turno
        return { text: GENERIC_RETRY_MESSAGE };
      }
      default:
        return unreachable(error);
    }
  }

  // ── Persistencia del borrador (PendingEventStore, TTL de onboarding) ───

  private async loadDraft(
    channelUserHash: string,
  ): Promise<{ partial: RegistrationPartial; step: RegistrationStep } | null> {
    const pending = await this.deps.pendingEventStore.takePending(channelUserHash);
    if (pending === null || pending.kind !== 'register_farm_and_user') {
      return null;
    }
    return { partial: pending.partial, step: pending.step as RegistrationStep };
  }

  private async saveDraft(
    channelUserHash: string,
    partial: RegistrationPartial,
    step: RegistrationStep,
  ): Promise<void> {
    await this.deps.pendingEventStore.savePending(
      channelUserHash,
      { kind: 'register_farm_and_user', partial, step },
      this.pendingTtlSeconds,
    );
  }

  /** Calcula el siguiente paso (o usa `stepOverride`), guarda el borrador y devuelve su pregunta. */
  private async advance(
    channelUserHash: string,
    partial: RegistrationPartial,
    ctx: OnboardingContext,
    stepOverride?: RegistrationStep,
  ): Promise<FarmReply> {
    const step = stepOverride ?? nextStep(partial);
    await this.saveDraft(channelUserHash, partial, step);
    return promptFor(step, partial, promptCtx(ctx));
  }
}

function promptCtx(ctx: OnboardingContext): { readonly channel: 'whatsapp' | 'telegram' } {
  return { channel: ctx.channel };
}

function prefixReply(prefix: string, prompt: RegistrationPrompt): RegistrationPrompt {
  return { ...prompt, text: `${prefix} ${prompt.text}` };
}

function buildRegisterInput(
  partial: RegistrationPartial,
  ctx: OnboardingContext,
): RegisterFarmAndUserInput | undefined {
  if (partial.phone === undefined) {
    return undefined;
  }

  if (partial.role === 'trabajador') {
    if (
      partial.idType === undefined ||
      partial.idNumber === undefined ||
      partial.selectedFarmId === undefined
    ) {
      return undefined;
    }
    return {
      kind: 'worker',
      user: {
        identificationType: partial.idType,
        identificationNumber: partial.idNumber,
        phone: partial.phone,
        channel: ctx.channel,
        phoneVerified: partial.phoneVerified ?? false,
        emailVerified: false,
      },
      farmId: partial.selectedFarmId,
    };
  }

  if (
    partial.farmName === undefined ||
    partial.legalType === undefined ||
    partial.taxId === undefined ||
    partial.location === undefined ||
    partial.cebaCapacity === undefined ||
    partial.breedingCapacity === undefined ||
    partial.totalCapacity === undefined ||
    partial.sanitaryRegistry === undefined ||
    partial.idType === undefined ||
    partial.idNumber === undefined
  ) {
    return undefined;
  }

  return {
    kind: 'owner',
    user: {
      identificationType: partial.idType,
      identificationNumber: partial.idNumber,
      phone: partial.phone,
      channel: ctx.channel,
      email: partial.email,
      phoneVerified: partial.phoneVerified ?? false,
      // El chat nunca verifica el correo por OTP (spec 001 §4.1.3): solo se
      // captura. Verificarlo de verdad es exclusivo del flujo web (§4.2).
      emailVerified: false,
    },
    farm: {
      name: partial.farmName,
      legalType: partial.legalType,
      taxIdType: partial.legalType === 'juridica' ? 'nit' : 'cedula',
      taxId: partial.taxId,
      location: partial.location,
      cebaCapacity: partial.cebaCapacity,
      breedingCapacity: partial.breedingCapacity,
      totalCapacity: partial.totalCapacity,
      sanitaryRegistry: partial.sanitaryRegistry,
    },
  };
}

function successMessage(outcome: RegistrationOutcome, partial: RegistrationPartial): string {
  if (outcome.membershipStatus === 'pendiente') {
    return `Listo, envié tu solicitud para unirte a "${outcome.farm.name}". Te avisamos cuando el administrador la apruebe.`;
  }
  if (partial.existingUserId !== undefined) {
    return `Listo, agregué la finca "${outcome.farm.name}" a tu cuenta.`;
  }
  return `Listo, creé tu cuenta y la finca "${outcome.farm.name}". ¡Bienvenido a PorcIA!`;
}

function unreachable(value: never): never {
  throw new Error(`RegistrationError no soportado: ${JSON.stringify(value)}`);
}
