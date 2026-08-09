import type {
  Expense,
  ExpenseSplit,
  Settlement,
  SettlementAllocation,
} from '../domain/types.js';

let counter = 0;
export function nextId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeExpense(overrides: Partial<Expense> = {}): Expense {
  const amount = overrides.amountTotalCents ?? 10_000_00;
  const occurredAt = overrides.occurredAt ?? '2026-08-05T15:00:00.000Z';
  return {
    id: overrides.id ?? nextId('exp'),
    accountId: null,
    categoryId: null,
    status: 'confirmed',
    source: 'manual',
    amountTotalCents: amount,
    myShareCents: overrides.myShareCents ?? amount,
    currency: 'COP',
    merchantRaw: null,
    merchantNormalized: null,
    description: null,
    notes: null,
    occurredAt,
    confirmedAt: occurredAt,
    recurringExpenseId: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
    ...overrides,
  };
}

export function makeSplit(overrides: Partial<ExpenseSplit> = {}): ExpenseSplit {
  return {
    id: overrides.id ?? nextId('split'),
    expenseId: overrides.expenseId ?? nextId('exp'),
    personId: overrides.personId ?? nextId('person'),
    amountCents: overrides.amountCents ?? 5_000_00,
    note: null,
    ...overrides,
  };
}

export function makeSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: overrides.id ?? nextId('settlement'),
    personId: overrides.personId ?? nextId('person'),
    amountCents: overrides.amountCents ?? 5_000_00,
    paidAt: overrides.paidAt ?? '2026-08-10T15:00:00.000Z',
    method: null,
    note: null,
    ...overrides,
  };
}

export function makeAllocation(overrides: Partial<SettlementAllocation> = {}): SettlementAllocation {
  return {
    id: overrides.id ?? nextId('alloc'),
    settlementId: overrides.settlementId ?? nextId('settlement'),
    splitId: overrides.splitId ?? nextId('split'),
    amountCents: overrides.amountCents ?? 5_000_00,
    ...overrides,
  };
}
