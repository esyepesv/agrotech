export type FarmId = string;

export interface FarmConfig {
  readonly metaPartosPorAno: number;
  readonly region: string;
}

// Raíz del agregado del módulo granja: identidad y configuración base
// (meta reproductiva y región) usada por los KPIs y el registro asistido.
export interface Farm {
  readonly id: FarmId;
  readonly name: string;
  readonly ownerName?: string;
  readonly config: FarmConfig;
  readonly createdAt: Date;
}

// Defaults del piloto (Colombia); el registro asistido puede sobreescribirlos.
export const DEFAULT_META_PARTOS_POR_ANO = 2.5;
export const DEFAULT_REGION = 'CO';
