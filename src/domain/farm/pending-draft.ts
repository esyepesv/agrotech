import type { FarmEventDraft } from './farm-event.js';
import { describeDraft } from './farm-event.js';
import type { LotStage } from './lot.js';

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

// Lo que guarda PendingEventStore: un evento a confirmar, o un alta de
// entidad ofrecida por el onboarding progresivo ("no tengo la 214, ¿la creo?").
export type PendingDraft =
  | { readonly kind: 'farm_event'; readonly draft: FarmEventDraft }
  | { readonly kind: 'register_entity'; readonly entity: EntityStub };

export function describePending(pending: PendingDraft): string {
  if (pending.kind === 'farm_event') {
    return describeDraft(pending.draft);
  }
  return describeEntityStub(pending.entity);
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
