import { describe, expect, it } from 'vitest';
import { makeAllocation, makeExpense, makeSettlement, makeSplit } from '../testing/factories.js';
import { computeDebts, proposeSettlementAllocation } from './debts.js';

describe('computeDebts', () => {
  it('suma lo que me debe cada persona', () => {
    const expense = makeExpense({ amountTotalCents: 100_000_00, myShareCents: 50_000_00 });
    const split = makeSplit({ expenseId: expense.id, personId: 'ana', amountCents: 50_000_00 });

    const debts = computeDebts({
      expenses: [expense],
      splits: [split],
      settlements: [],
      allocations: [],
    });

    expect(debts.totalPendingCents).toBe(50_000_00);
    expect(debts.byPerson[0]?.personId).toBe('ana');
    expect(debts.byPerson[0]?.pendingCents).toBe(50_000_00);
  });

  it('no cobra nada por un gasto que sigue pendiente de aprobar', () => {
    const expense = makeExpense({ status: 'pending', amountTotalCents: 100_000_00 });
    const split = makeSplit({ expenseId: expense.id, personId: 'ana', amountCents: 50_000_00 });

    const debts = computeDebts({
      expenses: [expense],
      splits: [split],
      settlements: [],
      allocations: [],
    });

    expect(debts.totalPendingCents).toBe(0);
  });

  it('descuenta los abonos parciales', () => {
    const expense = makeExpense({ amountTotalCents: 100_000_00, myShareCents: 50_000_00 });
    const split = makeSplit({ expenseId: expense.id, personId: 'ana', amountCents: 50_000_00 });
    const settlement = makeSettlement({ personId: 'ana', amountCents: 20_000_00 });
    const allocation = makeAllocation({
      settlementId: settlement.id,
      splitId: split.id,
      amountCents: 20_000_00,
    });

    const debts = computeDebts({
      expenses: [expense],
      splits: [split],
      settlements: [settlement],
      allocations: [allocation],
    });

    expect(debts.byPerson[0]?.paidCents).toBe(20_000_00);
    expect(debts.byPerson[0]?.pendingCents).toBe(30_000_00);
    expect(debts.byPerson[0]?.items[0]?.isSettled).toBe(false);
  });

  it('deja como saldo a favor lo que se abono de mas', () => {
    const expense = makeExpense({ amountTotalCents: 60_000_00, myShareCents: 30_000_00 });
    const split = makeSplit({ expenseId: expense.id, personId: 'ana', amountCents: 30_000_00 });
    const settlement = makeSettlement({ personId: 'ana', amountCents: 50_000_00 });
    const allocation = makeAllocation({
      settlementId: settlement.id,
      splitId: split.id,
      amountCents: 30_000_00,
    });

    const debts = computeDebts({
      expenses: [expense],
      splits: [split],
      settlements: [settlement],
      allocations: [allocation],
    });

    expect(debts.byPerson[0]?.pendingCents).toBe(0);
    expect(debts.byPerson[0]?.creditCents).toBe(20_000_00);
    expect(debts.byPerson[0]?.netCents).toBe(-20_000_00);
  });
});

describe('proposeSettlementAllocation', () => {
  it('reparte un pago redondo entre varios gastos, del mas viejo al mas nuevo', () => {
    const items = [
      {
        splitId: 's2',
        expenseId: 'e2',
        personId: 'ana',
        amountCents: 40_000_00,
        paidCents: 0,
        pendingCents: 40_000_00,
        isSettled: false,
        occurredAt: '2026-08-10T15:00:00.000Z',
        merchant: null,
        categoryId: null,
      },
      {
        splitId: 's1',
        expenseId: 'e1',
        personId: 'ana',
        amountCents: 30_000_00,
        paidCents: 0,
        pendingCents: 30_000_00,
        isSettled: false,
        occurredAt: '2026-08-01T15:00:00.000Z',
        merchant: null,
        categoryId: null,
      },
    ];

    const proposal = proposeSettlementAllocation(50_000_00, items);

    expect(proposal.allocations).toEqual([
      { splitId: 's1', amountCents: 30_000_00 },
      { splitId: 's2', amountCents: 20_000_00 },
    ]);
    expect(proposal.unallocatedCents).toBe(0);
  });

  it('deja como sobrante lo que excede la deuda', () => {
    const items = [
      {
        splitId: 's1',
        expenseId: 'e1',
        personId: 'ana',
        amountCents: 10_000_00,
        paidCents: 0,
        pendingCents: 10_000_00,
        isSettled: false,
        occurredAt: '2026-08-01T15:00:00.000Z',
        merchant: null,
        categoryId: null,
      },
    ];

    const proposal = proposeSettlementAllocation(15_000_00, items);
    expect(proposal.appliedCents).toBe(10_000_00);
    expect(proposal.unallocatedCents).toBe(5_000_00);
  });
});
