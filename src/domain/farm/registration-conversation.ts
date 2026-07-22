import type { IdentificationType } from './app-user.js';
import type { OperatorRole } from './operator.js';
import type { Channel } from '../message/incoming-message.js';
import type { InteractiveLayout, ReplyOption } from '../message/reply-option.js';
import { matchOption, optionId, parseOptionId } from '../message/reply-option.js';
import { err, ok, type Result } from '../shared/result.js';

// ── Tipos del estado conversacional ───────────────────────────────────────

// Pasos del flujo (spec 001 §4.1): el orden real lo decide `nextStep` según
// los campos ya presentes en `partial`, no un índice fijo — así "Corregir"
// o un borrador retomado tras el TTL siempre calculan el paso correcto.
export type RegistrationStep =
  | 'role'
  | 'phone'
  | 'farmName'
  | 'legalType'
  | 'taxId'
  | 'taxIdConfirm'
  | 'location'
  | 'cebaCapacity'
  | 'breedingCapacity'
  | 'totalCapacity'
  | 'sanitaryRegistry'
  | 'sanitaryRegistryConfirm'
  | 'idType'
  | 'idNumber'
  | 'idNumberConfirm'
  | 'email'
  | 'emailWrite'
  | 'workerFarmSearch'
  | 'workerFarmPick'
  | 'confirm'
  | 'anotherFarmPrompt'
  | 'approveWorker';

// Representación de un resultado de búsqueda de finca segura de importar
// desde `domain/` (no `FarmSearchResult` de `application/ports/farm-repository.ts`
// — el dominio no depende de application, regla de dependencia arquitectura.md §20).
export interface FarmSearchOption {
  readonly id: string;
  readonly name: string;
  readonly location?: string;
}

// Solicitud pendiente a presentar al dueño (punto 9, §4.1): una a la vez.
export interface PendingApprovalOption {
  readonly operatorId: string;
  readonly farmId: string;
  readonly farmName: string;
  readonly identificationNumber: string;
  readonly displayName?: string;
}

// Borrador acumulado: todo opcional porque se completa campo a campo. Vive
// tal cual dentro de `PendingDraft` (pending-draft.ts) — persistencia y TTL
// son responsabilidad del orquestador (application), este módulo es puro.
export interface RegistrationPartial {
  readonly role?: OperatorRole;
  readonly phone?: string;
  readonly phoneVerified?: boolean;

  readonly farmName?: string;
  readonly legalType?: 'natural' | 'juridica';
  readonly taxId?: string;
  readonly location?: string;
  readonly cebaCapacity?: number;
  readonly breedingCapacity?: number;
  readonly totalCapacity?: number;
  readonly sanitaryRegistry?: string;

  readonly idType?: IdentificationType;
  readonly idNumber?: string;
  readonly email?: string;
  readonly emailChoice?: 'write' | 'skip';

  readonly workerFarmQuery?: string;
  readonly workerFarmResults?: readonly FarmSearchOption[];
  readonly selectedFarmId?: string;
  readonly selectedFarmName?: string;

  // Multi-granja (spec 001 §4.1 punto 7): marca que la persona ya existe;
  // el orquestador precarga idType/idNumber/email desde el AppUser real, así
  // que `nextStep` los salta con la misma lógica de "campo ya presente" sin
  // necesitar una rama especial.
  readonly existingUserId?: string;

  // Lectura dígito por dígito (§4.1.3): valor dictado a la espera de
  // confirmación antes de escribirlo en el campo real.
  readonly pendingReadback?: {
    readonly field: 'taxId' | 'idNumber' | 'sanitaryRegistry';
    readonly value: string;
  };

  // Intentos fallidos consecutivos en el paso vigente (regla de 3 intentos, §5).
  readonly failedAttempts?: number;

  readonly pendingApproval?: PendingApprovalOption;
  readonly pendingApprovalDecision?: 'aprobar' | 'rechazar';

  readonly anotherFarmDecision?: 'yes' | 'no';
  readonly confirmDecision?: 'confirm' | 'correct' | 'cancel';
}

export interface RegistrationPromptContext {
  readonly channel: Channel;
}

// Estructuralmente idéntico a `FarmReply` (application/use-cases/farm-reply.ts)
// a propósito: el orquestador lo entrega tal cual, sin mapeo, y el dominio no
// depende de application (regla de dependencia).
export interface RegistrationPrompt {
  readonly text: string;
  readonly options?: readonly ReplyOption[];
  readonly layout?: InteractiveLayout;
  readonly requestContact?: boolean;
}

export interface RegistrationAnswerError {
  readonly message: string;
  // Cuando se define, el orquestador reenvía la pregunta de ESTE paso en vez
  // del paso vigente (§4.1.3, "audio en el campo de correo").
  readonly resetToStep?: RegistrationStep;
}

// ── Catálogos de opciones (namespaced con optionId, spec 001 §4.1.1) ─────
// La convención de este módulo: el campo del namespace es siempre el propio
// nombre del paso (`optionId(step, valor)`), así que un botón obsoleto se
// detecta comparando `parseOptionId(input).field` contra el paso vigente sin
// necesitar una tabla de mapeo aparte.

const ROLE_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('role', 'administrador_dueno'), label: 'Soy dueño' },
  { id: optionId('role', 'trabajador'), label: 'Soy trabajador' },
];

const LEGAL_TYPE_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('legalType', 'natural'), label: 'Natural' },
  { id: optionId('legalType', 'juridica'), label: 'Jurídica' },
];

const ID_TYPE_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('idType', 'CC'), label: 'Cédula' },
  { id: optionId('idType', 'CE'), label: 'Extranjería' },
  { id: optionId('idType', 'PA'), label: 'Pasaporte' },
];

const EMAIL_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('email', 'write'), label: 'Escribirlo' },
  { id: optionId('email', 'none'), label: 'No tengo' },
  { id: optionId('email', 'later'), label: 'Después' },
];

const CONFIRM_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('confirm', 'confirm'), label: 'Sí, confirmar' },
  { id: optionId('confirm', 'correct'), label: 'Corregir' },
  { id: optionId('confirm', 'cancel'), label: 'Cancelar' },
];

const ANOTHER_FARM_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('anotherFarmPrompt', 'yes'), label: 'Sí, otra finca' },
  { id: optionId('anotherFarmPrompt', 'no'), label: 'No, gracias' },
];

const APPROVE_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('approveWorker', 'aprobar'), label: 'Aprobar' },
  { id: optionId('approveWorker', 'rechazar'), label: 'Rechazar' },
];

function confirmValueOptions(step: RegistrationStep): readonly ReplyOption[] {
  return [
    { id: optionId(step, 'yes'), label: 'Sí, está bien' },
    { id: optionId(step, 'retry'), label: 'Corregir' },
  ];
}

function workerFarmPickOptions(results: readonly FarmSearchOption[]): readonly ReplyOption[] {
  return [
    ...results.map((r) => ({ id: optionId('workerFarmPick', r.id), label: r.name })),
    { id: optionId('workerFarmPick', 'none'), label: 'Ninguna de estas' },
  ];
}

/**
 * Opciones cerradas del paso vigente, o `undefined` si es de texto libre.
 * Fuente única para `promptFor` (qué botones pintar) y `applyAnswer` (contra
 * qué hacer `matchOption`) — evita que se desincronicen.
 */
export function optionsForStep(
  step: RegistrationStep,
  partial: RegistrationPartial,
): readonly ReplyOption[] | undefined {
  switch (step) {
    case 'role':
      return ROLE_OPTIONS;
    case 'legalType':
      return LEGAL_TYPE_OPTIONS;
    case 'idType':
      return ID_TYPE_OPTIONS;
    case 'email':
      return EMAIL_OPTIONS;
    case 'confirm':
      return CONFIRM_OPTIONS;
    case 'anotherFarmPrompt':
      return ANOTHER_FARM_OPTIONS;
    case 'approveWorker':
      return APPROVE_OPTIONS;
    case 'taxIdConfirm':
    case 'idNumberConfirm':
    case 'sanitaryRegistryConfirm':
      return confirmValueOptions(step);
    case 'workerFarmPick':
      return workerFarmPickOptions(partial.workerFarmResults ?? []);
    default:
      return undefined;
  }
}

// ── nextStep: el corazón de la máquina ────────────────────────────────────

/**
 * Siguiente campo faltante, calculado puramente a partir de lo que ya hay en
 * `partial` (nunca de un índice guardado aparte): así retomar un borrador,
 * "Corregir" un valor, o completar multi-granja (existingUserId precarga
 * idType/idNumber/email y estos campos se saltan solos) siempre resuelven al
 * paso correcto.
 */
export function nextStep(partial: RegistrationPartial): RegistrationStep {
  if (partial.pendingReadback !== undefined) {
    return `${partial.pendingReadback.field}Confirm` as RegistrationStep;
  }
  if (partial.role === undefined) {
    return 'role';
  }
  if (partial.phone === undefined) {
    return 'phone';
  }
  return partial.role === 'administrador_dueno' ? nextOwnerStep(partial) : nextWorkerStep(partial);
}

function nextOwnerStep(partial: RegistrationPartial): RegistrationStep {
  return nextOwnerFarmStep(partial) ?? nextOwnerPersonStep(partial) ?? 'confirm';
}

function nextOwnerFarmStep(partial: RegistrationPartial): RegistrationStep | undefined {
  if (partial.farmName === undefined) return 'farmName';
  if (partial.legalType === undefined) return 'legalType';
  if (partial.taxId === undefined) return 'taxId';
  if (partial.location === undefined) return 'location';
  if (partial.cebaCapacity === undefined) return 'cebaCapacity';
  if (partial.breedingCapacity === undefined) return 'breedingCapacity';
  if (partial.totalCapacity === undefined) return 'totalCapacity';
  if (partial.sanitaryRegistry === undefined) return 'sanitaryRegistry';
  return undefined;
}

function nextOwnerPersonStep(partial: RegistrationPartial): RegistrationStep | undefined {
  if (partial.idType === undefined) return 'idType';
  if (partial.idNumber === undefined) return 'idNumber';
  if (partial.emailChoice === undefined) return 'email';
  if (partial.emailChoice === 'write' && partial.email === undefined) return 'emailWrite';
  return undefined;
}

function nextWorkerStep(partial: RegistrationPartial): RegistrationStep {
  if (partial.idType === undefined) return 'idType';
  if (partial.idNumber === undefined) return 'idNumber';
  if (partial.selectedFarmId === undefined) {
    return partial.workerFarmResults !== undefined ? 'workerFarmPick' : 'workerFarmSearch';
  }
  return 'confirm';
}

// ── promptFor ──────────────────────────────────────────────────────────

const PHONE_QUESTION = '¿Cuál es tu número de celular? Puedes compartirlo o escribirlo.';

export function promptFor(
  step: RegistrationStep,
  partial: RegistrationPartial,
  ctx: RegistrationPromptContext,
): RegistrationPrompt {
  const options = optionsForStep(step, partial);
  const layout: InteractiveLayout | undefined =
    options === undefined ? undefined : step === 'workerFarmPick' ? 'list' : 'buttons';

  switch (step) {
    case 'role':
      return {
        text: '¿Eres el dueño/administrador de la finca o trabajas en ella?',
        options,
        layout,
      };
    case 'phone':
      return { text: PHONE_QUESTION, requestContact: ctx.channel === 'telegram' };
    case 'farmName':
      return { text: '¿Cómo se llama tu finca?' };
    case 'legalType':
      return {
        text: '¿Tu finca está registrada como persona natural o jurídica?',
        options,
        layout,
      };
    case 'taxId':
      return {
        text:
          partial.legalType === 'juridica'
            ? '¿Cuál es el NIT de la finca?'
            : '¿Cuál es el número de cédula del dueño de la finca?',
      };
    case 'taxIdConfirm':
      return { text: readbackPrompt(partial.pendingReadback?.value ?? ''), options, layout };
    case 'location':
      return { text: '¿Dónde queda la finca? (vereda, municipio, departamento)' };
    case 'cebaCapacity':
      return { text: '¿Cuál es la capacidad de ceba (número de cerdos)? Ejemplo: 250.' };
    case 'breedingCapacity':
      return { text: '¿Cuál es la capacidad de cría? Ejemplo: 20.' };
    case 'totalCapacity':
      return { text: '¿Cuál es la capacidad total de la finca? Ejemplo: 270.' };
    case 'sanitaryRegistry':
      return { text: '¿Cuál es el registro sanitario ICA de la finca?' };
    case 'sanitaryRegistryConfirm':
      return { text: readbackPrompt(partial.pendingReadback?.value ?? ''), options, layout };
    case 'idType':
      return { text: '¿Con qué tipo de documento te identificas?', options, layout };
    case 'idNumber':
      return { text: '¿Cuál es tu número de identificación?' };
    case 'idNumberConfirm':
      return { text: readbackPrompt(partial.pendingReadback?.value ?? ''), options, layout };
    case 'email':
      return { text: '¿Quieres agregar tu correo electrónico?', options, layout };
    case 'emailWrite':
      return { text: 'Escribe tu correo electrónico.' };
    case 'workerFarmSearch':
      return { text: '¿Cómo se llama la finca a la que perteneces?' };
    case 'workerFarmPick':
      return { text: 'Encontré estas fincas, ¿cuál es la tuya?', options, layout };
    case 'confirm':
      return { text: `${summaryOf(partial)} ¿Confirmo el registro?`, options, layout };
    case 'anotherFarmPrompt':
      return {
        text: 'Ya tienes una cuenta registrada. ¿Quieres registrar otra finca?',
        options,
        layout,
      };
    case 'approveWorker':
      return { text: approveWorkerText(partial.pendingApproval), options, layout };
    default:
      return unreachable(step);
  }
}

function readbackPrompt(value: string): string {
  return `Escuché: ${readbackText(value)}. ¿Es correcto?`;
}

function approveWorkerText(pending: PendingApprovalOption | undefined): string {
  if (!pending) {
    return 'No tengo una solicitud pendiente para mostrarte.';
  }
  const who = pending.displayName ?? 'Alguien';
  return `${who} (CC ${pending.identificationNumber}) pide unirse a ${pending.farmName}. ¿Apruebas?`;
}

// ── summaryOf ──────────────────────────────────────────────────────────

const ID_TYPE_LABELS: Record<IdentificationType, string> = {
  CC: 'cédula',
  CE: 'cédula de extranjería',
  PA: 'pasaporte',
};

export function summaryOf(partial: RegistrationPartial): string {
  return partial.role === 'trabajador' ? summaryOfWorker(partial) : summaryOfOwner(partial);
}

function summaryOfOwner(partial: RegistrationPartial): string {
  const legalLabel = partial.legalType === 'juridica' ? 'jurídica' : 'natural';
  const taxLabel = partial.legalType === 'juridica' ? 'NIT' : 'cédula';
  const idTypeLabel = partial.idType ? ID_TYPE_LABELS[partial.idType] : 'documento';
  const emailPart = partial.email ? `, correo ${partial.email}` : '';
  return (
    `Entendí: finca "${partial.farmName ?? ''}", persona ${legalLabel}, ${taxLabel} ${partial.taxId ?? ''}, ` +
    `ubicada en ${partial.location ?? ''}. Capacidad de ceba: ${partial.cebaCapacity ?? 0}, ` +
    `cría: ${partial.breedingCapacity ?? 0}, total: ${partial.totalCapacity ?? 0}. ` +
    `Registro sanitario: ${partial.sanitaryRegistry ?? ''}. Tú: ${idTypeLabel} ${partial.idNumber ?? ''}${emailPart}.`
  );
}

function summaryOfWorker(partial: RegistrationPartial): string {
  const idTypeLabel = partial.idType ? ID_TYPE_LABELS[partial.idType] : 'documento';
  return (
    `Entendí: ${idTypeLabel} ${partial.idNumber ?? ''}, solicitas unirte a ` +
    `"${partial.selectedFarmName ?? ''}".`
  );
}

// ── applyAnswer ────────────────────────────────────────────────────────

export interface ApplyAnswerOptions {
  readonly inputWasVoice: boolean;
}

const DEFAULT_APPLY_OPTIONS: ApplyAnswerOptions = { inputWasVoice: false };

/**
 * Aplica una respuesta (botón, texto libre o voz transcrita — todas llegan
 * como texto plano, `matchOption` las interpreta por igual) al paso vigente.
 * No conoce almacenamiento ni canal: el orquestador decide qué hacer con el
 * `partial` resultante (guardar, calcular `nextStep`, etc.).
 */
export function applyAnswer(
  partial: RegistrationPartial,
  step: RegistrationStep,
  rawInput: string,
  opts: ApplyAnswerOptions = DEFAULT_APPLY_OPTIONS,
): Result<RegistrationPartial, RegistrationAnswerError> {
  switch (step) {
    case 'role':
      return applyOption(partial, step, rawInput, (value) => ({
        ...partial,
        role: value as OperatorRole,
      }));
    case 'phone':
      return applyPhone(partial, rawInput);
    case 'farmName':
      return applyFreeText(
        partial,
        rawInput,
        'El nombre de la finca no puede estar vacío.',
        (v) => ({
          ...partial,
          farmName: v,
        }),
      );
    case 'legalType':
      return applyOption(partial, step, rawInput, (value) => ({
        ...partial,
        legalType: value as 'natural' | 'juridica',
      }));
    case 'taxId':
      return applyDigitField(partial, 'taxId', rawInput, opts);
    case 'taxIdConfirm':
      return applyReadbackConfirm(partial, 'taxId', step, rawInput);
    case 'location':
      return applyFreeText(partial, rawInput, 'La ubicación no puede estar vacía.', (v) => ({
        ...partial,
        location: v,
      }));
    case 'cebaCapacity':
      return applyCapacity(partial, rawInput, (v) => ({ ...partial, cebaCapacity: v }));
    case 'breedingCapacity':
      return applyCapacity(partial, rawInput, (v) => ({ ...partial, breedingCapacity: v }));
    case 'totalCapacity':
      return applyCapacity(partial, rawInput, (v) => ({ ...partial, totalCapacity: v }));
    case 'sanitaryRegistry':
      return applyDigitField(partial, 'sanitaryRegistry', rawInput, opts);
    case 'sanitaryRegistryConfirm':
      return applyReadbackConfirm(partial, 'sanitaryRegistry', step, rawInput);
    case 'idType':
      return applyOption(partial, step, rawInput, (value) => ({
        ...partial,
        idType: value as IdentificationType,
      }));
    case 'idNumber':
      return applyDigitField(partial, 'idNumber', rawInput, opts);
    case 'idNumberConfirm':
      return applyReadbackConfirm(partial, 'idNumber', step, rawInput);
    case 'email':
      return applyEmailChoice(partial, rawInput);
    case 'emailWrite':
      return applyEmailWrite(partial, rawInput, opts);
    case 'workerFarmSearch':
      return applyFreeText(
        partial,
        rawInput,
        'Dime el nombre (o la ubicación) de la finca.',
        (v) => ({ ...partial, workerFarmQuery: v }),
      );
    case 'workerFarmPick':
      return applyFarmPick(partial, rawInput);
    case 'confirm':
      return applyOption(partial, step, rawInput, (value) => ({
        ...partial,
        confirmDecision: value as 'confirm' | 'correct' | 'cancel',
      }));
    case 'anotherFarmPrompt':
      return applyOption(partial, step, rawInput, (value) => ({
        ...partial,
        anotherFarmDecision: value as 'yes' | 'no',
      }));
    case 'approveWorker':
      return applyOption(partial, step, rawInput, (value) => ({
        ...partial,
        pendingApprovalDecision: value as 'aprobar' | 'rechazar',
      }));
    default:
      return unreachable(step);
  }
}

function applyOption(
  partial: RegistrationPartial,
  step: RegistrationStep,
  rawInput: string,
  build: (value: string) => RegistrationPartial,
): Result<RegistrationPartial, RegistrationAnswerError> {
  const options = optionsForStep(step, partial) ?? [];
  const matched = matchOption(rawInput, options);
  if (matched === undefined) {
    return err({ message: 'No reconocí esa opción. Elige una de las alternativas.' });
  }
  const parsed = parseOptionId(matched.id);
  if (parsed === undefined) {
    return err({ message: 'No reconocí esa opción. Elige una de las alternativas.' });
  }
  return ok(build(parsed.value));
}

function applyFreeText(
  _partial: RegistrationPartial,
  rawInput: string,
  emptyMessage: string,
  build: (value: string) => RegistrationPartial,
): Result<RegistrationPartial, RegistrationAnswerError> {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return err({ message: emptyMessage });
  }
  return ok(build(trimmed));
}

function applyPhone(
  partial: RegistrationPartial,
  rawInput: string,
): Result<RegistrationPartial, RegistrationAnswerError> {
  const normalized = normalizeColombianPhone(rawInput);
  if (normalized === undefined) {
    return err({
      message:
        'Ese número no parece válido. Escríbelo así: 3001234567 (10 dígitos, empieza por 3).',
    });
  }
  return ok({ ...partial, phone: normalized });
}

function applyCapacity(
  partial: RegistrationPartial,
  rawInput: string,
  build: (value: number) => RegistrationPartial,
): Result<RegistrationPartial, RegistrationAnswerError> {
  const value = normalizeSpokenNumber(rawInput);
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    return err({
      message: 'No entendí ese número. Dime solo la cantidad, por ejemplo: 250.',
    });
  }
  return ok(build(value));
}

function applyDigitField(
  partial: RegistrationPartial,
  field: 'taxId' | 'idNumber' | 'sanitaryRegistry',
  rawInput: string,
  opts: ApplyAnswerOptions,
): Result<RegistrationPartial, RegistrationAnswerError> {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return err({ message: 'Ese dato no puede estar vacío. ¿Me lo dices de nuevo?' });
  }
  if (opts.inputWasVoice) {
    // Voz: no se escribe el campo directo, se lee de vuelta dígito por
    // dígito para confirmar (§4.1.3) — evita guardar un error de STT caro.
    return ok({ ...partial, pendingReadback: { field, value: trimmed } });
  }
  return ok({ ...partial, [field]: trimmed });
}

function applyReadbackConfirm(
  partial: RegistrationPartial,
  field: 'taxId' | 'idNumber' | 'sanitaryRegistry',
  step: RegistrationStep,
  rawInput: string,
): Result<RegistrationPartial, RegistrationAnswerError> {
  const options = optionsForStep(step, partial) ?? [];
  const matched = matchOption(rawInput, options);
  const value = matched ? parseOptionId(matched.id)?.value : undefined;
  if (value === undefined) {
    return err({ message: 'Responde si el dato que leí está correcto o si prefieres corregirlo.' });
  }
  if (value === 'retry') {
    return ok({ ...partial, pendingReadback: undefined });
  }
  const pending = partial.pendingReadback;
  if (pending === undefined || pending.field !== field) {
    return err({ message: 'Ese dato ya no está pendiente de confirmar.' });
  }
  return ok({ ...partial, [field]: pending.value, pendingReadback: undefined });
}

function applyEmailChoice(
  partial: RegistrationPartial,
  rawInput: string,
): Result<RegistrationPartial, RegistrationAnswerError> {
  const matched = matchOption(rawInput, EMAIL_OPTIONS);
  const value = matched ? parseOptionId(matched.id)?.value : undefined;
  if (value === undefined) {
    return err({ message: 'No reconocí esa opción. Elige una de las alternativas.' });
  }
  return ok({ ...partial, emailChoice: value === 'write' ? 'write' : 'skip' });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function applyEmailWrite(
  partial: RegistrationPartial,
  rawInput: string,
  opts: ApplyAnswerOptions,
): Result<RegistrationPartial, RegistrationAnswerError> {
  if (opts.inputWasVoice) {
    // §4.1.3: el correo no se dicta, se escribe.
    return err({
      message: 'El correo no se puede dictar por voz. Escríbelo, por favor.',
      resetToStep: 'email',
    });
  }
  const trimmed = rawInput.trim();
  if (!EMAIL_PATTERN.test(trimmed)) {
    return err({ message: 'Ese correo no parece válido. Ejemplo: nombre@correo.com.' });
  }
  return ok({ ...partial, email: trimmed.toLowerCase() });
}

function applyFarmPick(
  partial: RegistrationPartial,
  rawInput: string,
): Result<RegistrationPartial, RegistrationAnswerError> {
  const options = optionsForStep('workerFarmPick', partial) ?? [];
  const matched = matchOption(rawInput, options);
  const value = matched ? parseOptionId(matched.id)?.value : undefined;
  if (value === undefined) {
    return err({ message: 'No reconocí esa finca de la lista. Elige una opción.' });
  }
  if (value === 'none') {
    return ok({ ...partial, workerFarmResults: undefined, workerFarmQuery: undefined });
  }
  const picked = (partial.workerFarmResults ?? []).find((f) => f.id === value);
  if (picked === undefined) {
    return err({ message: 'No reconocí esa finca de la lista. Elige una opción.' });
  }
  return ok({
    ...partial,
    selectedFarmId: picked.id,
    selectedFarmName: picked.name,
    workerFarmResults: undefined,
  });
}

// ── Normalización de teléfono, números dictados y lectura dígito a dígito ─

const COLOMBIAN_MOBILE_LOCAL = /^3\d{9}$/;

function normalizeColombianPhone(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('57') ? digits.slice(2) : digits;
  return COLOMBIAN_MOBILE_LOCAL.test(local) ? `+57${local}` : undefined;
}

const DIGIT_WORDS = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
] as const;

/** "1032456789" → "uno–cero–tres–dos–cuatro–cinco–seis–siete–ocho–nueve" (§4.1.3). */
export function spellOutDigits(value: string): string {
  return value
    .split('')
    .map((ch) => (/\d/.test(ch) ? DIGIT_WORDS[Number(ch)] : ch))
    .join('–');
}

/** Deletrea si es puramente numérico; si no (p. ej. "ICA-0001"), lee el texto tal cual. */
function readbackText(value: string): string {
  return /^\d+$/.test(value) ? spellOutDigits(value) : value;
}

const NUMBER_UNITS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const NUMBER_TENS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const NUMBER_HUNDREDS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};

function normalizeNumberText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Numerales en palabras a dígitos ("doscientos cincuenta" → 250, §4.1.3). Si
 * un token no se reconoce, NO adivina: devuelve `undefined` para que el
 * llamador re-pregunte con un ejemplo en vez de guardar un valor inventado.
 */
export function normalizeSpokenNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const tokens = normalizeNumberText(trimmed)
    .split(' ')
    .filter((t) => t.length > 0 && t !== 'y');
  if (tokens.length === 0) {
    return undefined;
  }

  let total = 0;
  let current = 0;
  let matchedAny = false;
  for (const token of tokens) {
    if (token === 'mil') {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      matchedAny = true;
      continue;
    }
    const hundred = NUMBER_HUNDREDS[token];
    if (hundred !== undefined) {
      current += hundred;
      matchedAny = true;
      continue;
    }
    const ten = NUMBER_TENS[token];
    if (ten !== undefined) {
      current += ten;
      matchedAny = true;
      continue;
    }
    const unit = NUMBER_UNITS[token];
    if (unit !== undefined) {
      current += unit;
      matchedAny = true;
      continue;
    }
    return undefined;
  }
  return matchedAny ? total + current : undefined;
}

function unreachable(value: never): never {
  throw new Error(`paso de registro no soportado: ${JSON.stringify(value)}`);
}
