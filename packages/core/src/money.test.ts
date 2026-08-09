import { describe, expect, it } from 'vitest';
import { allocate, assertCents, formatMoney, percentOf, splitEvenly, sumCents, toCents } from './money.js';

describe('allocate', () => {
  it('reparte sin perder ni inventar centavos', () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(sumCents(parts)).toBe(100);
  });

  it('respeta los pesos desiguales', () => {
    const parts = allocate(1000, [3, 1]);
    expect(parts).toEqual([750, 250]);
  });

  it('mantiene el total exacto con pesos que no dividen bien', () => {
    const parts = allocate(1000, [1, 1, 1, 1, 1, 1, 1]);
    expect(sumCents(parts)).toBe(1000);
  });

  it('reparte el sobrante entre distintos participantes, no todo al primero', () => {
    // 10 centavos entre 4: dos reciben 3 y dos reciben 2.
    const parts = allocate(10, [1, 1, 1, 1]);
    expect(sumCents(parts)).toBe(10);
    expect(parts.filter((p) => p === 3)).toHaveLength(2);
  });

  it('rechaza pesos que suman cero', () => {
    expect(() => allocate(100, [0, 0])).toThrow();
  });
});

describe('splitEvenly', () => {
  it('divide una cuenta impar sin descuadrar', () => {
    const parts = splitEvenly(10_000_01, 3);
    expect(sumCents(parts)).toBe(10_000_01);
  });
});

describe('toCents', () => {
  it('convierte decimales sin errores de flotante', () => {
    expect(toCents(45_000.1)).toBe(4_500_010);
    expect(toCents(0.07)).toBe(7);
    expect(toCents(1.005)).toBe(101);
  });
});

describe('assertCents', () => {
  it('rechaza montos con decimales', () => {
    expect(() => assertCents(10.5)).toThrow(/entero en centavos/);
  });
});

describe('percentOf', () => {
  it('calcula porcentajes redondeando al centavo', () => {
    expect(percentOf(10_000, 33)).toBe(3_300);
    expect(percentOf(101, 50)).toBe(51);
  });
});

describe('formatMoney', () => {
  it('formatea pesos colombianos sin decimales', () => {
    const output = formatMoney(45_000_00);
    expect(output).toContain('45.000');
    expect(output).not.toContain(',00');
  });
});
