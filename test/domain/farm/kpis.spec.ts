import { describe, expect, it } from 'vitest';
import {
  conversionAlimenticia,
  consumoPorCerda,
  costoPorKg,
  diasAbiertos,
  diasParaCierreEstimado,
  partosPorAno,
} from '../../../src/domain/farm/kpis.js';

describe('diasAbiertos', () => {
  it('cuenta los días completos desde el último destete', () => {
    const destete = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date('2026-01-11T00:00:00.000Z');
    expect(diasAbiertos(destete, now)).toBe(10);
  });

  it('nunca es negativo si now es anterior al destete (dato inconsistente)', () => {
    const destete = new Date('2026-01-11T00:00:00.000Z');
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(diasAbiertos(destete, now)).toBe(0);
  });
});

describe('partosPorAno', () => {
  it('calcula el ritmo reproductivo real desde el ingreso', () => {
    const entryDate = new Date('2025-07-10T00:00:00.000Z');
    const now = new Date('2026-07-10T00:00:00.000Z'); // 1 año exacto
    expect(partosPorAno(2, entryDate, now)).toBeCloseTo(2, 1);
  });

  it('no divide por cero cuando entryDate == now', () => {
    const fecha = new Date('2026-07-10T00:00:00.000Z');
    expect(partosPorAno(0, fecha, fecha)).toBe(0);
    expect(Number.isFinite(partosPorAno(1, fecha, fecha))).toBe(true);
  });
});

describe('conversionAlimenticia', () => {
  it('divide kg de concentrado entre kg ganados', () => {
    expect(conversionAlimenticia(300, 100)).toBeCloseTo(3);
  });

  it('retorna undefined si no hubo ganancia de peso', () => {
    expect(conversionAlimenticia(300, 0)).toBeUndefined();
    expect(conversionAlimenticia(300, -5)).toBeUndefined();
  });
});

describe('costoPorKg', () => {
  it('divide el costo acumulado entre los kg producidos', () => {
    expect(costoPorKg(1_000_000, 500)).toBe(2000);
  });

  it('retorna undefined si no hubo producción', () => {
    expect(costoPorKg(1_000_000, 0)).toBeUndefined();
  });
});

describe('diasParaCierreEstimado', () => {
  it('divide la cantidad disponible entre el consumo diario', () => {
    expect(diasParaCierreEstimado(40, 4)).toBe(10);
  });

  it('retorna undefined si el consumo diario es cero o negativo', () => {
    expect(diasParaCierreEstimado(40, 0)).toBeUndefined();
    expect(diasParaCierreEstimado(40, -1)).toBeUndefined();
  });
});

describe('consumoPorCerda', () => {
  it('divide el consumo total entre el número de cerdas', () => {
    expect(consumoPorCerda(100, 20)).toBe(5);
  });

  it('retorna undefined si no hay cerdas', () => {
    expect(consumoPorCerda(100, 0)).toBeUndefined();
  });
});
