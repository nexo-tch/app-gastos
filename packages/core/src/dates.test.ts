import { describe, expect, it } from 'vitest';
import {
  addMonths,
  clampDayToMonth,
  daysInMonth,
  elapsedDaysInMonth,
  endOfMonthExclusive,
  monthKeyOf,
  startOfMonth,
} from './dates.js';

describe('monthKeyOf', () => {
  it('usa la hora local y no la UTC para decidir el mes', () => {
    // 2026-08-01 a las 02:00 UTC son las 21:00 del 31 de julio en Colombia.
    expect(monthKeyOf('2026-08-01T02:00:00.000Z')).toBe('2026-07');
  });

  it('respeta un desfase distinto', () => {
    expect(monthKeyOf('2026-08-01T02:00:00.000Z', '+00:00')).toBe('2026-08');
  });
});

describe('startOfMonth y endOfMonthExclusive', () => {
  it('marcan el mes local en instantes UTC', () => {
    expect(startOfMonth('2026-08').toISOString()).toBe('2026-08-01T05:00:00.000Z');
    expect(endOfMonthExclusive('2026-08').toISOString()).toBe('2026-09-01T05:00:00.000Z');
  });
});

describe('daysInMonth', () => {
  it('conoce febrero bisiesto', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2026-08')).toBe(31);
  });
});

describe('addMonths', () => {
  it('cruza el cambio de ano en ambos sentidos', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-08', -6)).toBe('2026-02');
  });
});

describe('elapsedDaysInMonth', () => {
  it('devuelve el dia actual dentro del mes en curso', () => {
    expect(elapsedDaysInMonth('2026-08', '2026-08-15T15:00:00.000Z')).toBe(15);
  });

  it('devuelve el mes completo si ya paso', () => {
    expect(elapsedDaysInMonth('2026-07', '2026-08-15T15:00:00.000Z')).toBe(31);
  });

  it('devuelve cero si el mes aun no empieza', () => {
    expect(elapsedDaysInMonth('2026-09', '2026-08-15T15:00:00.000Z')).toBe(0);
  });
});

describe('clampDayToMonth', () => {
  it('ajusta el dia 31 a los meses cortos', () => {
    expect(clampDayToMonth('2026-02', 31)).toBe(28);
    expect(clampDayToMonth('2026-08', 31)).toBe(31);
  });
});
