import type { FarmEventDraft } from './farm-event.js';
import { describeDraft } from './farm-event.js';
import type { LotStage } from './lot.js';
import type { RegistrationPartial } from './registration-conversation.js';

export interface FarmEntityStub {
  readonly entity: 'farm';
  readonly name: string;
  readonly ownerName?: string;
}

export interface SowEntityStub {
  readonly entity: 'sow';
  readonly chapeta: string;
}

export interface LotEntityStub {
  readonly entity: 'lot';
  readonly stage: LotStage;
  readonly animalCount: number;
}

export type EntityStub = FarmEntityStub | SowEntityStub | LotEntityStub;

// Lo que guarda PendingEventStore: un evento a confirmar, un alta de entidad
// ofrecida por el onboarding progresivo ("no tengo la 214, ¿la creo?"), o el
// borrador multi-turno del registro conversacional de spec 001 (`step` es
// `string`, no `RegistrationStep`, para no acoplar este tipo de persistencia
// al union exacto del dominio de registro — mismo espíritu que el resto del
// módulo, que guarda snapshots planos).
export type PendingDraft =
  | { readonly kind: 'farm_event'; readonly draft: FarmEventDraft }
  | { readonly kind: 'register_entity'; readonly entity: EntityStub }
  | {
      readonly kind: 'register_farm_and_user';
      readonly partial: RegistrationPartial;
      readonly step: string;
    };

export function describePending(pending: PendingDraft): string {
  switch (pending.kind) {
    case 'farm_event':
      return describeDraft(pending.draft);
    case 'register_entity':
      return describeEntityStub(pending.entity);
    case 'register_farm_and_user':
      return describeRegistrationDraft(pending);
    default:
      return unreachable(pending);
  }
}

function describeRegistrationDraft(
  pending: Extract<PendingDraft, { kind: 'register_farm_and_user' }>,
): string {
  return pending.partial.farmName
    ? `Registro de la finca "${pending.partial.farmName}" en curso`
    : 'Registro de cuenta y finca en curso';
}

function describeEntityStub(entity: EntityStub): string {
  switch (entity.entity) {
    case 'farm':
      return `Registro de la granja "${entity.name}"${entity.ownerName ? ` de ${entity.ownerName}` : ''}`;
    case 'sow':
      return `Registro de la cerda ${entity.chapeta}`;
    case 'lot':
      return `Registro de un lote de ${entity.stage} con ${entity.animalCount} animales`;
    default:
      return unreachable(entity);
  }
}

function unreachable(value: never): never {
  throw new Error(`stub de entidad no soportado: ${JSON.stringify(value)}`);
}
