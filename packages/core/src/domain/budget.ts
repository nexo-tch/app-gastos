import {
  daysInMonth as daysInMonthOf,
  elapsedDaysInMonth,
  monthKeyOf,
  DEFAULT_UTC_OFFSET,
  type MonthKey,
} from '../dates.js';
import { clampToZero, ratio as ratioOf, sumCents, type Cents } from '../money.js';
import type { Expense, RecurringInstanceStatus } from './types.js';

export const BUDGET_STATES = ['ok', 'warning', 'critical', 'exceeded'] as const;
export type BudgetState = (typeof BUDGET_STATES)[number];

export const DEFAULT_ALERT_THRESHOLDS = [0.5, 0.8, 1] as const;

export interface CategoryLimitInput {
  categoryId: string;
  limitCents: Cents;
}

/**
 * Gasto fijo del mes ya resuelto contra su definicion recurrente.
 * El motor no consulta la base: quien lo llama entrega la categoria resuelta.
 */
export interface PlannedCommitment {
  id: string;
  month: string;
  categoryId: string | null;
  plannedCents: Cents;
  status: RecurringInstanceStatus;
}

export interface BudgetComputationInput {
  month: MonthKey;
  /** `null` cuando el mes todavia no tiene presupuesto definido. */
  totalBudgetCents: Cents | null;
  categoryLimits?: readonly CategoryLimitInput[];
  expenses: readonly Expense[];
  commitments?: readonly PlannedCommitment[];
  now: Date | string;
  alertThresholds?: readonly number[];
  utcOffset?: string;
}

export interface CategoryBudgetSummary {
  categoryId: string | null;
  limitCents: Cents | null;
  /** Solo mi parte de los gastos confirmados. */
  spentCents: Cents;
  /** Gastos fijos del mes que aun no se han pagado. */
  committedCents: Cents;
  availableCents: Cents | null;
  ratio: number | null;
  state: BudgetState;
  expenseCount: number;
}

export interface BudgetSummary {
  month: MonthKey;
  hasBudget: boolean;
  budgetedCents: Cents;

  /** Lo que realmente consumio mi bolsillo: suma de `myShareCents` confirmados. */
  spentCents: Cents;
  /** Valor completo de las transacciones, incluida la parte de otros. */
  totalRegisteredCents: Cents;
  /** Parte que le corresponde a otras personas y no toca mis topes. */
  othersShareCents: Cents;
  /** Gastos fijos reservados desde el dia 1 y todavia sin pagar. */
  committedCents: Cents;
  /** Gastos detectados esperando que los apruebe. No consumen presupuesto. */
  pendingReviewCents: Cents;
  pendingReviewCount: number;

  /** Lo que queda descontando ya los fijos por venir. Es el numero honesto. */
  availableCents: Cents;
  /** Lo que queda sin descontar los fijos. Util solo para comparar. */
  availableBeforeFixedCents: Cents;

  ratio: number;
  state: BudgetState;

  daysInMonth: number;
  daysElapsed: number;
  daysRemaining: number;
  /** Ritmo diario del gasto variable, excluyendo los fijos. */
  dailyBurnCents: Cents;
  /** Cuanto puedo gastar por dia con lo que queda. */
  safeDailyCents: Cents;
  projectedEndOfMonthCents: Cents;
  isProjectedToExceed: boolean;

  byCategory: CategoryBudgetSummary[];
  thresholds: number[];
}

/**
 * Calcula el estado del presupuesto de un mes.
 *
 * Reglas que sostienen todo el modelo:
 *  - solo los gastos `confirmed` consumen presupuesto;
 *  - se suma `myShareCents`, nunca `amountTotalCents`;
 *  - los gastos fijos aun no pagados reservan presupuesto desde el dia 1;
 *  - un fijo ya pagado vive como gasto normal, por eso no se cuenta dos veces.
 */
export function computeBudgetSummary(input: BudgetComputationInput): BudgetSummary {
  const {
    month,
    totalBudgetCents,
    categoryLimits = [],
    expenses,
    commitments = [],
    now,
    alertThresholds,
    utcOffset = DEFAULT_UTC_OFFSET,
  } = input;

  const thresholds = normalizeThresholds(alertThresholds);
  const monthExpenses = expenses.filter(
    (expense) => !expense.deletedAt && monthKeyOf(expense.occurredAt, utcOffset) === month,
  );

  const confirmed = monthExpenses.filter((expense) => expense.status === 'confirmed');
  const pending = monthExpenses.filter((expense) => expense.status === 'pending');

  const spentCents = sumCents(confirmed.map((e) => e.myShareCents));
  const totalRegisteredCents = sumCents(confirmed.map((e) => e.amountTotalCents));
  const othersShareCents = totalRegisteredCents - spentCents;

  const plannedCommitments = commitments.filter(
    (commitment) => commitment.month === month && commitment.status === 'planned',
  );
  const committedCents = sumCents(plannedCommitments.map((c) => c.plannedCents));

  const pendingReviewCents = sumCents(pending.map((e) => e.myShareCents));

  const budgetedCents = totalBudgetCents ?? 0;
  const hasBudget = totalBudgetCents !== null && totalBudgetCents > 0;

  const availableBeforeFixedCents = budgetedCents - spentCents;
  const availableCents = availableBeforeFixedCents - committedCents;

  const consumedCents = spentCents + committedCents;
  const globalRatio = hasBudget ? ratioOf(consumedCents, budgetedCents) : 0;

  const totalDays = daysInMonthOf(month);
  const daysElapsed = elapsedDaysInMonth(month, now, utcOffset);
  const daysRemaining = Math.max(totalDays - daysElapsed, 0);

  // El gasto fijo no representa ritmo de consumo diario, lo sacamos de la proyeccion.
  const variableSpentCents = sumCents(
    confirmed.filter((e) => e.source !== 'recurring').map((e) => e.myShareCents),
  );
  const dailyBurnCents = daysElapsed > 0 ? Math.round(variableSpentCents / daysElapsed) : 0;
  const projectedEndOfMonthCents = spentCents + committedCents + dailyBurnCents * daysRemaining;
  const safeDailyCents = daysRemaining > 0 ? Math.round(clampToZero(availableCents) / daysRemaining) : 0;

  return {
    month,
    hasBudget,
    budgetedCents,
    spentCents,
    totalRegisteredCents,
    othersShareCents,
    committedCents,
    pendingReviewCents,
    pendingReviewCount: pending.length,
    availableCents,
    availableBeforeFixedCents,
    ratio: globalRatio,
    state: stateFromRatio(globalRatio, thresholds, hasBudget),
    daysInMonth: totalDays,
    daysElapsed,
    daysRemaining,
    dailyBurnCents,
    safeDailyCents,
    projectedEndOfMonthCents,
    isProjectedToExceed: hasBudget && projectedEndOfMonthCents > budgetedCents,
    byCategory: summarizeCategories(confirmed, plannedCommitments, categoryLimits, thresholds),
    thresholds,
  };
}

function summarizeCategories(
  confirmed: readonly Expense[],
  plannedCommitments: readonly PlannedCommitment[],
  categoryLimits: readonly CategoryLimitInput[],
  thresholds: number[],
): CategoryBudgetSummary[] {
  const buckets = new Map<string | null, { spent: Cents; committed: Cents; count: number }>();

  const bucketFor = (categoryId: string | null) => {
    const existing = buckets.get(categoryId);
    if (existing) return existing;
    const created = { spent: 0, committed: 0, count: 0 };
    buckets.set(categoryId, created);
    return created;
  };

  for (const expense of confirmed) {
    const bucket = bucketFor(expense.categoryId ?? null);
    bucket.spent += expense.myShareCents;
    bucket.count += 1;
  }

  for (const commitment of plannedCommitments) {
    const bucket = bucketFor(commitment.categoryId ?? null);
    bucket.committed += commitment.plannedCents;
  }

  // Un tope definido debe aparecer aunque todavia no tenga gasto.
  for (const limit of categoryLimits) bucketFor(limit.categoryId);

  const limitByCategory = new Map(categoryLimits.map((l) => [l.categoryId, l.limitCents]));

  return Array.from(buckets.entries())
    .map(([categoryId, bucket]) => {
      const limitCents = categoryId === null ? null : limitByCategory.get(categoryId) ?? null;
      const consumed = bucket.spent + bucket.committed;
      const hasLimit = limitCents !== null && limitCents > 0;
      const categoryRatio = hasLimit ? ratioOf(consumed, limitCents) : null;
      return {
        categoryId,
        limitCents,
        spentCents: bucket.spent,
        committedCents: bucket.committed,
        availableCents: hasLimit ? limitCents - consumed : null,
        ratio: categoryRatio,
        state: categoryRatio === null ? 'ok' : stateFromRatio(categoryRatio, thresholds, true),
        expenseCount: bucket.count,
      } satisfies CategoryBudgetSummary;
    })
    .sort((a, b) => b.spentCents + b.committedCents - (a.spentCents + a.committedCents));
}

export function stateFromRatio(value: number, thresholds: number[], hasBudget = true): BudgetState {
  if (!hasBudget) return 'ok';
  const [warning = 0.5, critical = 0.8] = thresholds;
  if (value >= 1) return 'exceeded';
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'ok';
}

function normalizeThresholds(thresholds?: readonly number[]): number[] {
  const source = thresholds && thresholds.length > 0 ? thresholds : DEFAULT_ALERT_THRESHOLDS;
  return Array.from(new Set(source.filter((t) => Number.isFinite(t) && t > 0))).sort((a, b) => a - b);
}
