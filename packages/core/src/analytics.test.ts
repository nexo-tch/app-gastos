import { describe, expect, it } from 'vitest';
import { categoryDistribution, categoryDistributionRange } from './analytics.js';
import type { Expense } from './domain/types.js';

const gasto = (overrides: Partial<Expense> & Pick<Expense, 'id' | 'occurredAt' | 'myShareCents'>): Expense => ({
  accountId: null,
  categoryId: 'mercado',
  status: 'confirmed',
  source: 'manual',
  amountTotalCents: overrides.myShareCents,
  currency: 'COP',
  merchantRaw: null,
  merchantNormalized: null,
  description: null,
  confirmedAt: overrides.occurredAt,
  createdAt: overrides.occurredAt,
  updatedAt: overrides.occurredAt,
  deletedAt: null,
  ...overrides,
});

describe('categoryDistributionRange', () => {
  const expenses = [
    gasto({ id: 'a', occurredAt: '2026-08-05T12:00:00.000Z', myShareCents: 1000, categoryId: 'mercado' }),
    gasto({ id: 'b', occurredAt: '2026-07-10T12:00:00.000Z', myShareCents: 2000, categoryId: 'mercado' }),
    gasto({ id: 'c', occurredAt: '2026-06-01T12:00:00.000Z', myShareCents: 4000, categoryId: 'ropa' }),
    gasto({ id: 'd', occurredAt: '2026-01-01T12:00:00.000Z', myShareCents: 8000, categoryId: 'ropa' }),
  ];

  it('limita a los ultimos N meses', () => {
    const filas = categoryDistributionRange(expenses, '2026-08', { count: 3 });
    expect(filas).toHaveLength(2);
    expect(filas[0]?.categoryId).toBe('ropa');
    expect(filas[0]?.spentCents).toBe(4000);
    expect(filas[1]?.categoryId).toBe('mercado');
    expect(filas[1]?.spentCents).toBe(3000);
  });

  it('con null incluye todo el historial', () => {
    const filas = categoryDistributionRange(expenses, '2026-08', { count: null });
    expect(filas[0]?.categoryId).toBe('ropa');
    expect(filas[0]?.spentCents).toBe(12000);
    expect(filas[1]?.categoryId).toBe('mercado');
    expect(filas[1]?.spentCents).toBe(3000);
  });

  it('coincide con categoryDistribution en un solo mes', () => {
    const mes = categoryDistribution(expenses, '2026-08');
    const rango = categoryDistributionRange(expenses, '2026-08', { count: 1 });
    expect(rango).toEqual(mes);
  });
});
