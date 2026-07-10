// KPIs de dominio: funciones puras, sin repos ni infraestructura. El tiempo
// se recibe explícito (`now`) para que los tests sean deterministas sin mocks.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;

/** Días desde el último destete sin gestación confirmada. */
export function diasAbiertos(lastWeaningAt: Date, now: Date): number {
  const diffMs = now.getTime() - lastWeaningAt.getTime();
  return Math.max(0, Math.round(diffMs / MS_PER_DAY));
}

/** Ritmo reproductivo real (partos/año) contado desde el ingreso de la cerda. */
export function partosPorAno(farrowingCount: number, entryDate: Date, now: Date): number {
  const diasEnGranja = Math.max(1, (now.getTime() - entryDate.getTime()) / MS_PER_DAY);
  const anosEnGranja = diasEnGranja / DAYS_PER_YEAR;
  return farrowingCount / anosEnGranja;
}

/** kg de concentrado por kg ganado. `undefined` si no hubo ganancia (evita división por cero/negativos). */
export function conversionAlimenticia(
  kgConcentrado: number,
  kgGanados: number,
): number | undefined {
  if (kgGanados <= 0) return undefined;
  return kgConcentrado / kgGanados;
}

/** Costo acumulado por kg producido. `undefined` si no hubo producción. */
export function costoPorKg(costoAcumulado: number, kgProducidos: number): number | undefined {
  if (kgProducidos <= 0) return undefined;
  return costoAcumulado / kgProducidos;
}

/** Días restantes hasta agotar el inventario disponible al ritmo de consumo diario actual. */
export function diasParaCierreEstimado(
  qtyDisponible: number,
  consumoDiario: number,
): number | undefined {
  if (consumoDiario <= 0) return undefined;
  return qtyDisponible / consumoDiario;
}

/** Consumo promedio por cerda en el período. `undefined` si no hay cerdas. */
export function consumoPorCerda(consumoTotal: number, numCerdas: number): number | undefined {
  if (numCerdas <= 0) return undefined;
  return consumoTotal / numCerdas;
}
