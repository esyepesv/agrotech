import type { IdentificationType } from './app-user.js';
import type { OperatorRole } from './operator.js';
import type { Channel } from '../message/incoming-message.js';
import type { InteractiveLayout, ReplyOption } from '../message/reply-option.js';
import { matchOption, optionId, parseOptionId } from '../message/reply-option.js';
import { normalizeDestination } from '../otp/otp-destination.js';
import { err, ok, type Result } from '../shared/result.js';
import { isValidEmail } from './registration.js';

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
  | 'emailConfirm'
  | 'workerFarmSearch'
  | 'workerFarmPick'
  | 'confirm'
  // Elegir QUÉ corregir en vez de reiniciar: antes "Corregir" descartaba el
  // borrador entero y volvía a la primera pregunta.
  | 'correctPick'
  // Confirmación de "cancelar": el borrador puede llevar once respuestas,
  // demasiado para perderlo por una palabra suelta.
  | 'cancelConfirm'
  | 'anotherFarmPrompt'
  | 'approveWorker';

/** Campos que se leen de vuelta cuando llegan dictados, antes de guardarlos. */
export type ReadbackField = 'taxId' | 'idNumber' | 'sanitaryRegistry' | 'email';

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
  readonly identificationType: IdentificationType;
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
    readonly field: ReadbackField;
    readonly value: string;
  };

  // Intentos fallidos consecutivos en el paso vigente (regla de 3 intentos, §5).
  readonly failedAttempts?: number;

  readonly pendingApproval?: PendingApprovalOption;
  readonly pendingApprovalDecision?: 'aprobar' | 'rechazar';

  readonly anotherFarmDecision?: 'yes' | 'no';
  readonly confirmDecision?: 'confirm' | 'correct' | 'cancel';
  readonly cancelDecision?: 'yes' | 'no';
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
  { id: optionId('role', 'administrador_dueno'), label: 'Soy dueño o administrador' },
  { id: optionId('role', 'trabajador'), label: 'Soy trabajador' },
];

const LEGAL_TYPE_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('legalType', 'natural'), label: 'Natural' },
  { id: optionId('legalType', 'juridica'), label: 'Jurídica' },
];

const ID_TYPE_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('idType', 'TI'), label: 'Tarjeta de Identidad' },
  { id: optionId('idType', 'CC'), label: 'Cédula de Ciudadanía' },
  { id: optionId('idType', 'CE'), label: 'Cédula de Extranjería' },
  { id: optionId('idType', 'PPT'), label: 'Permiso por Protección Temporal' },
  { id: optionId('idType', 'PEP'), label: 'Permiso Especial de Permanencia' },
  { id: optionId('idType', 'PA'), label: 'Pasaporte' },
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

const CANCEL_CONFIRM_OPTIONS: readonly ReplyOption[] = [
  { id: optionId('cancelConfirm', 'yes'), label: 'Sí, cancelar' },
  { id: optionId('cancelConfirm', 'no'), label: 'No, seguir' },
];

function correctPickOptions(partial: RegistrationPartial): readonly ReplyOption[] {
  return correctableSteps(partial).map((step) => ({
    id: optionId('correctPick', step),
    label: STEP_LABELS[step] ?? step,
  }));
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
    case 'confirm':
      return CONFIRM_OPTIONS;
    case 'correctPick':
      return correctPickOptions(partial);
    case 'cancelConfirm':
      return CANCEL_CONFIRM_OPTIONS;
    case 'anotherFarmPrompt':
      return ANOTHER_FARM_OPTIONS;
    case 'approveWorker':
      return APPROVE_OPTIONS;
    case 'taxIdConfirm':
    case 'idNumberConfirm':
    case 'sanitaryRegistryConfirm':
    case 'emailConfirm':
      return confirmValueOptions(step);
    case 'workerFarmPick':
      return workerFarmPickOptions(partial.workerFarmResults ?? []);
    default:
      return undefined;
  }
}

// ── Retroceder y corregir ─────────────────────────────────────────────────
// Todo esto se apoya en `nextStep`: como calcula el siguiente campo FALTANTE,
// "borrar un campo" equivale a "volver a esa pregunta". No hace falta un
// índice de posición aparte.

const OWNER_STEP_ORDER: readonly RegistrationStep[] = [
  'role',
  'phone',
  'farmName',
  'legalType',
  'taxId',
  'location',
  'cebaCapacity',
  'breedingCapacity',
  'totalCapacity',
  'sanitaryRegistry',
  'idType',
  'idNumber',
  'email',
];

const WORKER_STEP_ORDER: readonly RegistrationStep[] = [
  'role',
  'phone',
  'idType',
  'idNumber',
  'email',
  'workerFarmSearch',
];

function stepOrder(partial: RegistrationPartial): readonly RegistrationStep[] {
  return partial.role === 'trabajador' ? WORKER_STEP_ORDER : OWNER_STEP_ORDER;
}

/** Etiquetas de los pasos que la persona puede corregir desde el resumen. */
const STEP_LABELS: Partial<Record<RegistrationStep, string>> = {
  phone: 'Celular',
  farmName: 'Nombre de la finca',
  legalType: 'Tipo de persona',
  taxId: 'Identificación tributaria',
  location: 'Ubicación',
  cebaCapacity: 'Capacidad de ceba',
  breedingCapacity: 'Capacidad de cría',
  totalCapacity: 'Capacidad total',
  sanitaryRegistry: 'Registro sanitario',
  idType: 'Tipo de documento',
  idNumber: 'Número de documento',
  email: 'Correo electrónico',
  workerFarmSearch: 'Finca a la que te unes',
};

/** Borra el dato de un paso para que `nextStep` vuelva a preguntarlo. */
export function clearStepField(
  partial: RegistrationPartial,
  step: RegistrationStep,
): RegistrationPartial {
  // Retroceder o corregir siempre invalida un valor pendiente de confirmar:
  // si no se descartara, `nextStep` volvería a la lectura de vuelta y el
  // flujo quedaría dando vueltas sobre el dato que se quería cambiar.
  partial = { ...partial, pendingReadback: undefined };
  switch (step) {
    case 'role':
      return { ...partial, role: undefined };
    case 'phone':
      // El celular detectado por el canal se vuelve a aceptar solo si el
      // canal lo aporta otra vez; aquí se olvida también su verificación.
      return { ...partial, phone: undefined, phoneVerified: undefined };
    case 'farmName':
      return { ...partial, farmName: undefined };
    case 'legalType':
      return { ...partial, legalType: undefined };
    case 'taxId':
      return { ...partial, taxId: undefined };
    case 'location':
      return { ...partial, location: undefined };
    case 'cebaCapacity':
      return { ...partial, cebaCapacity: undefined };
    case 'breedingCapacity':
      return { ...partial, breedingCapacity: undefined };
    case 'totalCapacity':
      return { ...partial, totalCapacity: undefined };
    case 'sanitaryRegistry':
      return { ...partial, sanitaryRegistry: undefined };
    case 'idType':
      return { ...partial, idType: undefined };
    case 'idNumber':
      return { ...partial, idNumber: undefined };
    case 'email':
      return { ...partial, email: undefined };
    case 'workerFarmSearch':
    case 'workerFarmPick':
      return {
        ...partial,
        workerFarmQuery: undefined,
        workerFarmResults: undefined,
        selectedFarmId: undefined,
        selectedFarmName: undefined,
      };
    default:
      return partial;
  }
}

/**
 * Paso anterior al vigente según el orden del rol. `undefined` si ya se está
 * en el primero (no hay a dónde retroceder). Desde el resumen (`confirm`) el
 * anterior es el último campo del recorrido.
 */
export function previousStep(
  step: RegistrationStep,
  partial: RegistrationPartial,
): RegistrationStep | undefined {
  // Durante una lectura de vuelta ("entendí 1032456789, ¿es correcto?"),
  // "atrás" significa descartar lo que se entendió y volver a dictar ese
  // mismo dato — no retroceder al campo anterior.
  const readback = partial.pendingReadback;
  if (readback !== undefined && step === `${readback.field}Confirm`) {
    return readback.field;
  }
  const order = stepOrder(partial);
  const index = step === 'confirm' ? order.length : order.indexOf(step);
  if (index <= 0) {
    return undefined;
  }
  return order[index - 1];
}

/** Pasos ya respondidos que tiene sentido ofrecer para corregir. */
export function correctableSteps(partial: RegistrationPartial): readonly RegistrationStep[] {
  return stepOrder(partial).filter((step) => {
    if (STEP_LABELS[step] === undefined) return false;
    // El celular probado por el canal no se corrige escribiendo otro: la
    // identidad la da el canal, no el texto (§4.1.2).
    if (step === 'phone' && partial.phoneVerified === true) return false;
    return hasAnswer(partial, step);
  });
}

function hasAnswer(partial: RegistrationPartial, step: RegistrationStep): boolean {
  switch (step) {
    case 'phone':
      return partial.phone !== undefined;
    case 'farmName':
      return partial.farmName !== undefined;
    case 'legalType':
      return partial.legalType !== undefined;
    case 'taxId':
      return partial.taxId !== undefined;
    case 'location':
      return partial.location !== undefined;
    case 'cebaCapacity':
      return partial.cebaCapacity !== undefined;
    case 'breedingCapacity':
      return partial.breedingCapacity !== undefined;
    case 'totalCapacity':
      return partial.totalCapacity !== undefined;
    case 'sanitaryRegistry':
      return partial.sanitaryRegistry !== undefined;
    case 'idType':
      return partial.idType !== undefined;
    case 'idNumber':
      return partial.idNumber !== undefined;
    case 'email':
      return partial.email !== undefined;
    case 'workerFarmSearch':
      return partial.selectedFarmId !== undefined;
    default:
      return false;
  }
}

export type GlobalCommand = 'back' | 'cancel';

const BACK_WORDS = new Set(['atras', 'volver', 'regresar', 'anterior']);
const CANCEL_WORDS = new Set(['cancelar', 'cancela', 'salir']);

/**
 * Comandos que valen en cualquier campo del recorrido. Antes no existían: con
 * un registro en curso el orquestador manda TODO al paso vigente, así que
 * escribir "cancelar" en la pregunta del nombre dejaba la finca llamándose
 * "cancelar". Solo se reconocen en pasos de texto libre; los pasos de opción
 * ya tienen sus propios botones.
 */
export function parseGlobalCommand(rawInput: string): GlobalCommand | undefined {
  const normalized = rawInput
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim();
  if (BACK_WORDS.has(normalized)) return 'back';
  if (CANCEL_WORDS.has(normalized)) return 'cancel';
  return undefined;
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
  if (partial.email === undefined) return 'email';
  return undefined;
}

function nextWorkerStep(partial: RegistrationPartial): RegistrationStep {
  if (partial.idType === undefined) return 'idType';
  if (partial.idNumber === undefined) return 'idNumber';
  if (partial.email === undefined) return 'email';
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
    options === undefined
      ? undefined
      : step === 'workerFarmPick' || options.length > 3
        ? 'list'
        : 'buttons';

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
      return {
        text: 'Dime tu correo electrónico (puedes escribirlo o dictarlo diciendo "arroba" y "punto"). Te sirve para entrar desde el computador.',
      };
    case 'emailConfirm':
      return {
        // El correo se lee tal cual, no deletreado: "juan@finca.co" dicho
        // dígito por dígito sería ilegible.
        text: `Entendí el correo ${partial.pendingReadback?.value ?? ''}. ¿Es correcto?`,
        options,
        layout,
      };
    case 'workerFarmSearch':
      return { text: '¿Cómo se llama la finca a la que perteneces?' };
    case 'workerFarmPick':
      return { text: 'Encontré estas fincas, ¿cuál es la tuya?', options, layout };
    case 'confirm':
      return { text: `${summaryOf(partial)} ¿Confirmo el registro?`, options, layout };
    case 'correctPick':
      return { text: '¿Qué dato quieres corregir?', options, layout };
    case 'cancelConfirm':
      return {
        text: '¿Seguro que quieres cancelar el registro? Se perderá lo que llevamos.',
        options,
        layout,
      };
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
  return `${who} (${ID_TYPE_LABELS[pending.identificationType]} ${pending.identificationNumber}) pide unirse a ${pending.farmName}. ¿Apruebas?`;
}

// ── summaryOf ──────────────────────────────────────────────────────────

const ID_TYPE_LABELS: Record<IdentificationType, string> = {
  TI: 'tarjeta de identidad',
  CC: 'cédula de ciudadanía',
  CE: 'cédula de extranjería',
  PPT: 'permiso por protección temporal',
  PEP: 'permiso especial de permanencia',
  PA: 'pasaporte',
};

export function summaryOf(partial: RegistrationPartial): string {
  return partial.role === 'trabajador' ? summaryOfWorker(partial) : summaryOfOwner(partial);
}

function summaryOfOwner(partial: RegistrationPartial): string {
  const legalLabel = partial.legalType === 'juridica' ? 'jurídica' : 'natural';
  const taxLabel = partial.legalType === 'juridica' ? 'NIT' : 'cédula';
  const idTypeLabel = partial.idType ? ID_TYPE_LABELS[partial.idType] : 'documento';
  const emailPart = `, correo ${partial.email ?? ''}`;
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
      return applyEmail(partial, rawInput, opts);
    case 'emailConfirm':
      return applyReadbackConfirm(partial, 'email', step, rawInput);
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
    case 'correctPick':
      // Borra SOLO el campo elegido; el resto del borrador sobrevive y
      // `nextStep` lleva de vuelta a esa pregunta.
      return applyOption(partial, step, rawInput, (value) =>
        clearStepField({ ...partial, confirmDecision: undefined }, value as RegistrationStep),
      );
    case 'cancelConfirm':
      return applyOption(partial, step, rawInput, (value) => ({
        ...partial,
        cancelDecision: value as 'yes' | 'no',
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
  field: ReadbackField,
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
  field: ReadbackField,
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

/**
 * Palabras que la gente dicta en lugar de los símbolos. Whisper además mete
 * espacios entre letras deletreadas, así que se quitan todos al final.
 */
const SPOKEN_EMAIL_SYMBOLS: readonly (readonly [RegExp, string])[] = [
  [/\barrobas?\b/g, '@'],
  [/\bat\b/g, '@'],
  [/\bguion bajo\b/g, '_'],
  [/\bguion medio\b/g, '-'],
  [/\bguion\b/g, '-'],
  [/\bpunto\b/g, '.'],
  [/\bpuntos?\b/g, '.'],
];

/** "juan arroba gmail punto com" → "juan@gmail.com". */
export function normalizeSpokenEmail(raw: string): string {
  const withSymbols = SPOKEN_EMAIL_SYMBOLS.reduce(
    (text, [pattern, symbol]) => text.replace(pattern, symbol),
    raw.toLowerCase(),
  );
  return withSymbols.replace(/\s+/g, '').replace(/,$/, '').replace(/\.$/, '');
}

function applyEmail(
  partial: RegistrationPartial,
  rawInput: string,
  opts: ApplyAnswerOptions,
): Result<RegistrationPartial, RegistrationAnswerError> {
  // Misma normalización que el resto del dominio (registration.ts): minúsculas
  // sin espacios, para no tener dos criterios de "correo válido" divergentes.
  const normalized = opts.inputWasVoice
    ? normalizeSpokenEmail(rawInput)
    : normalizeDestination(rawInput, 'email');
  if (!isValidEmail(normalized)) {
    return err({
      message: opts.inputWasVoice
        ? 'No entendí bien el correo. Dilo otra vez diciendo "arroba" y "punto", o escríbelo.'
        : 'Ese correo no parece válido. ¿Me lo escribes otra vez?',
      resetToStep: 'email',
    });
  }
  if (opts.inputWasVoice) {
    // Dictar un correo es donde más se equivoca la transcripción: se lee de
    // vuelta para confirmar antes de guardarlo, igual que cédula y NIT.
    return ok({ ...partial, pendingReadback: { field: 'email', value: normalized } });
  }
  return ok({ ...partial, email: normalized });
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

  // Dictado real: Whisper devuelve "50." o "son 250 cerdos", no un número
  // pelado. Si hay dígitos, mandan ellos — antes cualquier palabra alrededor
  // (incluso el punto final) hacía fallar el paso entero. Con varios números
  // no se adivina cuál es.
  const digits = trimmed.match(/\d+/g);
  if (digits !== null) {
    return digits.length === 1 ? Number(digits[0]) : undefined;
  }

  const tokens = normalizeNumberText(trimmed)
    .split(' ')
    .filter((t) => t.length > 0 && t !== 'y');
  if (tokens.length === 0) {
    return undefined;
  }

  // Se suma la racha más larga de palabras-número y se ignora lo que venga
  // alrededor ("doscientos cincuenta cerdos"). Una palabra desconocida cierra
  // la racha en vez de descartar la respuesta entera.
  let best: number | undefined;
  let total = 0;
  let current = 0;
  let matchedAny = false;

  const closeRun = (): void => {
    if (matchedAny) {
      const value = total + current;
      best = best === undefined ? value : Math.max(best, value);
    }
    total = 0;
    current = 0;
    matchedAny = false;
  };

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
    closeRun();
  }
  closeRun();
  return best;
}

function unreachable(value: never): never {
  throw new Error(`paso de registro no soportado: ${JSON.stringify(value)}`);
}
