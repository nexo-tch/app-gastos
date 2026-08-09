import {
  DEFAULT_UTC_OFFSET,
  addMonths,
  daysInMonth as daysInMonthOf,
  dayOfMonthOf,
  elapsedDaysInMonth,
  monthKeyOf,
  type MonthKey,
} from './dates.js';
import { sumCents, type Cents } from './money.js';
import type { Expense, ExpenseSplit } from './domain/types.js';

export interface AnalyticsOptions {
  utcOffset?: string;
}

function confirmedInMonth(
  expenses: readonly Expense[],
  month: MonthKey,
  utcOffset: string,
): Expense[] {
  return expenses.filter(
    (expense) =>
      !expense.deletedAt &&
      expense.status === 'confirmed' &&
      monthKeyOf(expense.occurredAt, utcOffset) === month,
  );
}

export interface CategorySlice {
  categoryId: string | null;
  spentCents: Cents;
  /** Fraccion del gasto total del mes, de 0 a 1. */
  share: number;
  expenseCount: number;
}

function bucketByCategory(expenses: readonly Expense[]): CategorySlice[] {
  const total = sumCents(expenses.map((expense) => expense.myShareCents));

  const buckets = new Map<string | null, { cents: Cents; count: number }>();
  for (const expense of expenses) {
    const key = expense.categoryId ?? null;
    const bucket = buckets.get(key) ?? { cents: 0, count: 0 };
    bucket.cents += expense.myShareCents;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .map(([categoryId, bucket]) => ({
      categoryId,
      spentCents: bucket.cents,
      share: total > 0 ? bucket.cents / total : 0,
      expenseCount: bucket.count,
    }))
    .sort((a, b) => b.spentCents - a.spentCents);
}

/** Como se reparte mi gasto entre categorias. Alimenta la dona del panel. */
export function categoryDistribution(
  expenses: readonly Expense[],
  month: MonthKey,
  options: AnalyticsOptions = {},
): CategorySlice[] {
  const { utcOffset = DEFAULT_UTC_OFFSET } = options;
  return bucketByCategory(confirmedInMonth(expenses, month, utcOffset));
}

/**
 * Reparto por categoría en un rango de meses. `count: null` incluye todo el historial.
 */
export function categoryDistributionRange(
  expenses: readonly Expense[],
  currentMonth: MonthKey,
  options: AnalyticsOptions & { count?: number | null } = {},
): CategorySlice[] {
  const { utcOffset = DEFAULT_UTC_OFFSET, count = 6 } = options;

  if (count === null) {
    return bucketByCategory(
      expenses.filter((expense) => !expense.deletedAt && expense.status === 'confirmed'),
    );
  }

  const months = new Set<MonthKey>();
  for (let i = count - 1; i >= 0; i -= 1) months.add(addMonths(currentMonth, -i));

  return bucketByCategory(
    expenses.filter(
      (expense) =>
        !expense.deletedAt &&
        expense.status === 'confirmed' &&
        months.has(monthKeyOf(expense.occurredAt, utcOffset)),
    ),
  );
}

export interface DailyPoint {
  day: number;
  spentCents: Cents;
  cumulativeCents: Cents;
  /** Linea de referencia: gasto parejo del presupuesto a lo largo del mes. */
  idealCumulativeCents: Cents | null;
  isFuture: boolean;
}

/**
 * Evolucion del gasto dia a dia contra el ritmo ideal del presupuesto.
 * Los dias futuros van con acumulado nulo para que la grafica no dibuje una
 * linea plana enganosa hasta fin de mes.
 */
export function dailySeries(
  expenses: readonly Expense[],
  month: MonthKey,
  options: AnalyticsOptions & { budgetCents?: Cents | null; now?: Date | string } = {},
): DailyPoint[] {
  const { utcOffset = DEFAULT_UTC_OFFSET, budgetCents = null, now = new Date() } = options;

  const total = daysInMonthOf(month);
  const elapsed = elapsedDaysInMonth(month, now, utcOffset);
  const scoped = confirmedInMonth(expenses, month, utcOffset);

  const perDay = new Array<Cents>(total + 1).fill(0);
  for (const expense of scoped) {
    const day = dayOfMonthOf(expense.occurredAt, utcOffset);
    perDay[day] = (perDay[day] ?? 0) + expense.myShareCents;
  }

  const points: DailyPoint[] = [];
  let cumulative = 0;

  for (let day = 1; day <= total; day += 1) {
    const spent = perDay[day] ?? 0;
    cumulative += spent;
    const isFuture = day > elapsed;
    points.push({
      day,
      spentCents: spent,
      cumulativeCents: isFuture ? 0 : cumulative,
      idealCumulativeCents: budgetCents ? Math.round((budgetCents * day) / total) : null,
      isFuture,
    });
  }

  return points;
}

export interface MerchantSlice {
  merchant: string;
  spentCents: Cents;
  expenseCount: number;
}

export function topMerchants(
  expenses: readonly Expense[],
  month: MonthKey,
  options: AnalyticsOptions & { limit?: number } = {},
): MerchantSlice[] {
  const { utcOffset = DEFAULT_UTC_OFFSET, limit = 5 } = options;
  const scoped = confirmedInMonth(expenses, month, utcOffset);

  const buckets = new Map<string, { cents: Cents; count: number }>();
  for (const expense of scoped) {
    const merchant = expense.merchantNormalized ?? expense.merchantRaw ?? expense.description;
    if (!merchant) continue;
    const bucket = buckets.get(merchant) ?? { cents: 0, count: 0 };
    bucket.cents += expense.myShareCents;
    bucket.count += 1;
    buckets.set(merchant, bucket);
  }

  return Array.from(buckets.entries())
    .map(([merchant, bucket]) => ({
      merchant,
      spentCents: bucket.cents,
      expenseCount: bucket.count,
    }))
    .sort((a, b) => b.spentCents - a.spentCents)
    .slice(0, limit);
}

export interface MonthPoint {
  month: MonthKey;
  spentCents: Cents;
  expenseCount: number;
}

/** Serie de los ultimos `count` meses, incluido el actual. */
export function monthlyTrend(
  expenses: readonly Expense[],
  currentMonth: MonthKey,
  options: AnalyticsOptions & { count?: number } = {},
): MonthPoint[] {
  const { utcOffset = DEFAULT_UTC_OFFSET, count = 6 } = options;

  const months: MonthKey[] = [];
  for (let i = count - 1; i >= 0; i -= 1) months.push(addMonths(currentMonth, -i));

  return months.map((month) => {
    const scoped = confirmedInMonth(expenses, month, utcOffset);
    return {
      month,
      spentCents: sumCents(scoped.map((expense) => expense.myShareCents)),
      expenseCount: scoped.length,
    };
  });
}

export interface SharedOverview {
  sharedExpenseCount: number;
  /** Valor completo de los gastos que comparto con alguien. */
  totalSharedCents: Cents;
  myPartCents: Cents;
  othersPartCents: Cents;
}

export function sharedOverview(
  expenses: readonly Expense[],
  splits: readonly ExpenseSplit[],
  month: MonthKey,
  options: AnalyticsOptions = {},
): SharedOverview {
  const { utcOffset = DEFAULT_UTC_OFFSET } = options;
  const scoped = confirmedInMonth(expenses, month, utcOffset);
  const sharedExpenseIds = new Set(splits.map((split) => split.expenseId));
  const shared = scoped.filter((expense) => sharedExpenseIds.has(expense.id));

  const totalSharedCents = sumCents(shared.map((expense) => expense.amountTotalCents));
  const myPartCents = sumCents(shared.map((expense) => expense.myShareCents));

  return {
    sharedExpenseCount: shared.length,
    totalSharedCents,
    myPartCents,
    othersPartCents: totalSharedCents - myPartCents,
  };
}
