export type FarmId = string;

export interface FarmConfig {
  readonly metaPartosPorAno: number;
  readonly region: string;
}

// Raíz del agregado del módulo granja: identidad y configuración base
// (meta reproductiva y región) usada por los KPIs y el registro asistido.
//
// Campos de spec 001 (registro de usuario + granja): aditivos y opcionales
// a propósito, para no romper el Farm "delgado" que crea el flujo legado de
// v1.1 (RegisterFarm/ConfirmFarmEvent, que no los conoce). El wizard de
// RegisterFarmAndUser siempre los completa.
export interface Farm {
  readonly id: FarmId;
  readonly name: string;
  readonly ownerName?: string;
  readonly config: FarmConfig;
  readonly createdAt: Date;
  readonly legalType?: 'natural' | 'juridica';
  readonly taxIdType?: 'cedula' | 'nit';
  readonly taxId?: string;
  readonly location?: string;
  readonly cebaCapacity?: number;
  readonly breedingCapacity?: number;
  readonly totalCapacity?: number;
  readonly sanitaryRegistry?: string;
}

// Defaults del piloto (Colombia); el registro asistido puede sobreescribirlos.
export const DEFAULT_META_PARTOS_POR_ANO = 2.5;
export const DEFAULT_REGION = 'CO';
