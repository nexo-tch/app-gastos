import { sumCents, type Cents } from '../money.js';
import type { Expense, ExpenseSplit, Settlement, SettlementAllocation } from './types.js';

export interface DebtItem {
  splitId: string;
  expenseId: string;
  personId: string;
  /** Lo que le corresponde de ese gasto. */
  amountCents: Cents;
  paidCents: Cents;
  pendingCents: Cents;
  isSettled: boolean;
  occurredAt: string;
  merchant: string | null;
  categoryId: string | null;
}

export interface PersonDebtSummary {
  personId: string;
  owedCents: Cents;
  paidCents: Cents;
  pendingCents: Cents;
  /** Abonos que entrego pero que todavia no se aplicaron a ningun gasto. */
  creditCents: Cents;
  /** Deuda real: lo pendiente menos el saldo a favor. Puede ser negativo. */
  netCents: Cents;
  pendingItemCount: number;
  oldestPendingAt: string | null;
  items: DebtItem[];
}

export interface DebtsOverview {
  totalPendingCents: Cents;
  totalCreditCents: Cents;
  totalNetCents: Cents;
  peopleWithDebtCount: number;
  byPerson: PersonDebtSummary[];
}

export interface DebtsInput {
  expenses: readonly Expense[];
  splits: readonly ExpenseSplit[];
  settlements: readonly Settlement[];
  allocations: readonly SettlementAllocation[];
}

/**
 * Cuanto me debe cada persona.
 *
 * Solo generan deuda los splits de gastos confirmados: un gasto pendiente de
 * aprobar o reversado no le puede cobrar nada a nadie.
 */
export function computeDebts(input: DebtsInput): DebtsOverview {
  const { expenses, splits, settlements, allocations } = input;

  const expenseById = new Map(
    expenses.filter((expense) => !expense.deletedAt).map((expense) => [expense.id, expense]),
  );

  const paidBySplit = new Map<string, Cents>();
  for (const allocation of allocations) {
    paidBySplit.set(allocation.splitId, (paidBySplit.get(allocation.splitId) ?? 0) + allocation.amountCents);
  }

  const byPerson = new Map<string, PersonDebtSummary>();
  const summaryFor = (personId: string): PersonDebtSummary => {
    const existing = byPerson.get(personId);
    if (existing) return existing;
    const created: PersonDebtSummary = {
      personId,
      owedCents: 0,
      paidCents: 0,
      pendingCents: 0,
      creditCents: 0,
      netCents: 0,
      pendingItemCount: 0,
      oldestPendingAt: null,
      items: [],
    };
    byPerson.set(personId, created);
    return created;
  };

  for (const split of splits) {
    const expense = expenseById.get(split.expenseId);
    if (!expense || expense.status !== 'confirmed') continue;

    const paidCents = Math.min(paidBySplit.get(split.id) ?? 0, split.amountCents);
    const pendingCents = split.amountCents - paidCents;

    const item: DebtItem = {
      splitId: split.id,
      expenseId: split.expenseId,
      personId: split.personId,
      amountCents: split.amountCents,
      paidCents,
      pendingCents,
      isSettled: pendingCents === 0,
      occurredAt: expense.occurredAt,
      merchant: expense.merchantNormalized ?? expense.merchantRaw ?? expense.description ?? null,
      categoryId: expense.categoryId ?? null,
    };

    const summary = summaryFor(split.personId);
    summary.items.push(item);
    summary.owedCents += split.amountCents;
    summary.paidCents += paidCents;
    summary.pendingCents += pendingCents;
    if (pendingCents > 0) {
      summary.pendingItemCount += 1;
      if (summary.oldestPendingAt === null || expense.occurredAt < summary.oldestPendingAt) {
        summary.oldestPendingAt = expense.occurredAt;
      }
    }
  }

  // Un abono que supera lo asignado queda como saldo a favor de la persona.
  const allocatedBySettlement = new Map<string, Cents>();
  for (const allocation of allocations) {
    allocatedBySettlement.set(
      allocation.settlementId,
      (allocatedBySettlement.get(allocation.settlementId) ?? 0) + allocation.amountCents,
    );
  }
  for (const settlement of settlements) {
    const allocated = allocatedBySettlement.get(settlement.id) ?? 0;
    const credit = settlement.amountCents - allocated;
    if (credit === 0) continue;
    summaryFor(settlement.personId).creditCents += credit;
  }

  const people = Array.from(byPerson.values()).map((summary) => {
    summary.netCents = summary.pendingCents - summary.creditCents;
    summary.items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return summary;
  });

  people.sort((a, b) => b.netCents - a.netCents);

  return {
    totalPendingCents: sumCents(people.map((p) => p.pendingCents)),
    totalCreditCents: sumCents(people.map((p) => p.creditCents)),
    totalNetCents: sumCents(people.map((p) => p.netCents)),
    peopleWithDebtCount: people.filter((p) => p.netCents > 0).length,
    byPerson: people,
  };
}

export interface ProposedAllocation {
  splitId: string;
  amountCents: Cents;
}

export interface SettlementProposal {
  allocations: ProposedAllocation[];
  appliedCents: Cents;
  /** Sobrante que queda como saldo a favor. */
  unallocatedCents: Cents;
}

/**
 * Reparte un abono entre los gastos pendientes de una persona, del mas antiguo
 * al mas reciente. Es lo que espera cualquiera cuando le pasan una suma redonda
 * que cubre varios gastos.
 */
export function proposeSettlementAllocation(
  amountCents: Cents,
  pendingItems: readonly DebtItem[],
): SettlementProposal {
  if (amountCents <= 0) {
    return { allocations: [], appliedCents: 0, unallocatedCents: Math.max(amountCents, 0) };
  }

  const ordered = [...pendingItems]
    .filter((item) => item.pendingCents > 0)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const allocations: ProposedAllocation[] = [];
  let remaining = amountCents;

  for (const item of ordered) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, item.pendingCents);
    allocations.push({ splitId: item.splitId, amountCents: applied });
    remaining -= applied;
  }

  return {
    allocations,
    appliedCents: amountCents - remaining,
    unallocatedCents: remaining,
  };
}
