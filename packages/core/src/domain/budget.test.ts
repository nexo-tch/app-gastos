import { describe, expect, it } from 'vitest';
import { makeExpense } from '../testing/factories.js';
import { computeBudgetSummary, type PlannedCommitment } from './budget.js';

const NOW = '2026-08-15T15:00:00.000Z';
const MONTH = '2026-08';

function commitment(overrides: Partial<PlannedCommitment> = {}): PlannedCommitment {
  return {
    id: 'c1',
    month: MONTH,
    categoryId: null,
    plannedCents: 0,
    status: 'planned',
    ...overrides,
  };
}

describe('computeBudgetSummary', () => {
  it('solo cuenta mi parte de un gasto compartido', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 3_000_000_00,
      expenses: [makeExpense({ amountTotalCents: 200_000_00, myShareCents: 100_000_00 })],
      now: NOW,
    });

    expect(summary.spentCents).toBe(100_000_00);
    expect(summary.totalRegisteredCents).toBe(200_000_00);
    expect(summary.othersShareCents).toBe(100_000_00);
  });

  it('ignora los gastos pendientes, rechazados y reversados', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 1_000_000_00,
      expenses: [
        makeExpense({ amountTotalCents: 10_000_00, myShareCents: 10_000_00, status: 'confirmed' }),
        makeExpense({ amountTotalCents: 20_000_00, myShareCents: 20_000_00, status: 'pending' }),
        makeExpense({ amountTotalCents: 30_000_00, myShareCents: 30_000_00, status: 'rejected' }),
        makeExpense({ amountTotalCents: 40_000_00, myShareCents: 40_000_00, status: 'reversed' }),
      ],
      now: NOW,
    });

    expect(summary.spentCents).toBe(10_000_00);
    expect(summary.pendingReviewCents).toBe(20_000_00);
    expect(summary.pendingReviewCount).toBe(1);
  });

  it('reserva presupuesto para los gastos fijos que aun no se pagan', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 3_000_000_00,
      expenses: [makeExpense({ amountTotalCents: 500_000_00, myShareCents: 500_000_00 })],
      commitments: [commitment({ plannedCents: 1_500_000_00 })],
      now: NOW,
    });

    expect(summary.committedCents).toBe(1_500_000_00);
    expect(summary.availableBeforeFixedCents).toBe(2_500_000_00);
    expect(summary.availableCents).toBe(1_000_000_00);
  });

  it('no cuenta dos veces un fijo que ya se pago', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 3_000_000_00,
      expenses: [
        makeExpense({ amountTotalCents: 1_500_000_00, myShareCents: 1_500_000_00, source: 'recurring' }),
      ],
      commitments: [commitment({ plannedCents: 1_500_000_00, status: 'posted' })],
      now: NOW,
    });

    expect(summary.spentCents).toBe(1_500_000_00);
    expect(summary.committedCents).toBe(0);
    expect(summary.availableCents).toBe(1_500_000_00);
  });

  it('deja el gasto fijo fuera del ritmo diario de la proyeccion', () => {
    const withFixed = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 3_000_000_00,
      expenses: [
        makeExpense({ amountTotalCents: 1_500_000_00, myShareCents: 1_500_000_00, source: 'recurring' }),
        makeExpense({ amountTotalCents: 150_000_00, myShareCents: 150_000_00, source: 'manual' }),
      ],
      now: NOW,
    });

    // 150.000 en 15 dias son 10.000 diarios, sin contar el arriendo.
    expect(withFixed.dailyBurnCents).toBe(10_000_00);
  });

  it('clasifica el estado segun los umbrales', () => {
    const base = {
      month: MONTH,
      totalBudgetCents: 100_000_00,
      now: NOW,
    } as const;

    expect(
      computeBudgetSummary({ ...base, expenses: [makeExpense({ amountTotalCents: 10_000_00, myShareCents: 10_000_00 })] }).state,
    ).toBe('ok');
    expect(
      computeBudgetSummary({ ...base, expenses: [makeExpense({ amountTotalCents: 60_000_00, myShareCents: 60_000_00 })] }).state,
    ).toBe('warning');
    expect(
      computeBudgetSummary({ ...base, expenses: [makeExpense({ amountTotalCents: 85_000_00, myShareCents: 85_000_00 })] }).state,
    ).toBe('critical');
    expect(
      computeBudgetSummary({ ...base, expenses: [makeExpense({ amountTotalCents: 120_000_00, myShareCents: 120_000_00 })] }).state,
    ).toBe('exceeded');
  });

  it('deja fuera los gastos de otros meses', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 1_000_000_00,
      expenses: [
        makeExpense({ amountTotalCents: 10_000_00, myShareCents: 10_000_00, occurredAt: '2026-08-05T15:00:00.000Z' }),
        makeExpense({ amountTotalCents: 99_000_00, myShareCents: 99_000_00, occurredAt: '2026-07-20T15:00:00.000Z' }),
      ],
      now: NOW,
    });

    expect(summary.spentCents).toBe(10_000_00);
  });

  it('muestra un tope de categoria aunque todavia no tenga gasto', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 1_000_000_00,
      categoryLimits: [{ categoryId: 'mercado', limitCents: 400_000_00 }],
      expenses: [],
      now: NOW,
    });

    const mercado = summary.byCategory.find((c) => c.categoryId === 'mercado');
    expect(mercado?.limitCents).toBe(400_000_00);
    expect(mercado?.availableCents).toBe(400_000_00);
    expect(mercado?.state).toBe('ok');
  });

  it('marca la categoria como excedida al pasar su tope', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 1_000_000_00,
      categoryLimits: [{ categoryId: 'mercado', limitCents: 100_000_00 }],
      expenses: [
        makeExpense({ categoryId: 'mercado', amountTotalCents: 130_000_00, myShareCents: 130_000_00 }),
      ],
      now: NOW,
    });

    const mercado = summary.byCategory.find((c) => c.categoryId === 'mercado');
    expect(mercado?.state).toBe('exceeded');
    expect(mercado?.availableCents).toBe(-30_000_00);
  });

  it('avisa cuando el ritmo actual va a reventar el presupuesto', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: 1_000_000_00,
      // 600.000 en 15 dias: 40.000 diarios sobre 31 dias supera el millon.
      expenses: [makeExpense({ amountTotalCents: 600_000_00, myShareCents: 600_000_00 })],
      now: NOW,
    });

    expect(summary.isProjectedToExceed).toBe(true);
    expect(summary.projectedEndOfMonthCents).toBeGreaterThan(1_000_000_00);
  });

  it('funciona sin presupuesto definido', () => {
    const summary = computeBudgetSummary({
      month: MONTH,
      totalBudgetCents: null,
      expenses: [makeExpense({ amountTotalCents: 50_000_00, myShareCents: 50_000_00 })],
      now: NOW,
    });

    expect(summary.hasBudget).toBe(false);
    expect(summary.state).toBe('ok');
    expect(summary.spentCents).toBe(50_000_00);
  });
});
