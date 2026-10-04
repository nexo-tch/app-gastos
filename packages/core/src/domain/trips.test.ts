import { describe, expect, it } from 'vitest';
import {
  TripError,
  computeTripBalances,
  convertToBase,
  resolveTripExpense,
  simplifyDebts,
} from './trips.js';

const EUR = (euros: number) => Math.round(euros * 100);

describe('resolveTripExpense', () => {
  it('Camp Nou: lo pago yo y se reparte entre los cuatro', () => {
    const parts = resolveTripExpense({
      totalCents: EUR(400),
      payers: [{ memberId: 'camilo', amountCents: EUR(400) }],
      mode: 'equal',
      participants: ['camilo', 'andres', 'leo', 'edxa'].map((memberId) => ({ memberId })),
    });

    expect(parts).toEqual([
      { memberId: 'camilo', paidCents: EUR(400), owedCents: EUR(100) },
      { memberId: 'andres', paidCents: 0, owedCents: EUR(100) },
      { memberId: 'leo', paidCents: 0, owedCents: EUR(100) },
      { memberId: 'edxa', paidCents: 0, owedCents: EUR(100) },
    ]);
  });

  it('una cena que pagan dos, repartida entre tres, no pierde centavos', () => {
    const parts = resolveTripExpense({
      totalCents: 10_000,
      payers: [
        { memberId: 'camilo', amountCents: 6_000 },
        { memberId: 'andres', amountCents: 4_000 },
      ],
      mode: 'equal',
      participants: [{ memberId: 'camilo' }, { memberId: 'andres' }, { memberId: 'leo' }],
    });

    const owed = parts.map((p) => p.owedCents);
    expect(owed.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(owed).toEqual([3_334, 3_333, 3_333]);
    expect(parts.find((p) => p.memberId === 'leo')?.paidCents).toBe(0);
  });

  it('quien paga puede no consumir', () => {
    const parts = resolveTripExpense({
      totalCents: 9_000,
      payers: [{ memberId: 'camilo', amountCents: 9_000 }],
      mode: 'equal',
      participants: [{ memberId: 'leo' }, { memberId: 'edxa' }],
    });

    expect(parts.find((p) => p.memberId === 'camilo')).toEqual({
      memberId: 'camilo',
      paidCents: 9_000,
      owedCents: 0,
    });
  });

  it('por montos tiene que cuadrar exacto', () => {
    const base = {
      totalCents: 10_000,
      payers: [{ memberId: 'a', amountCents: 10_000 }],
      mode: 'amounts' as const,
    };

    expect(() =>
      resolveTripExpense({
        ...base,
        participants: [
          { memberId: 'a', amountCents: 3_000 },
          { memberId: 'b', amountCents: 5_000 },
        ],
      }),
    ).toThrow(TripError);

    const parts = resolveTripExpense({
      ...base,
      participants: [
        { memberId: 'a', amountCents: 3_000 },
        { memberId: 'b', amountCents: 7_000 },
      ],
    });
    expect(parts.map((p) => p.owedCents)).toEqual([3_000, 7_000]);
  });

  it('por porcentaje tiene que sumar 100', () => {
    const base = {
      totalCents: 10_000,
      payers: [{ memberId: 'a', amountCents: 10_000 }],
      mode: 'percent' as const,
    };

    expect(() =>
      resolveTripExpense({
        ...base,
        participants: [
          { memberId: 'a', percent: 50 },
          { memberId: 'b', percent: 40 },
        ],
      }),
    ).toThrow(/90%/);

    const parts = resolveTripExpense({
      ...base,
      participants: [
        { memberId: 'a', percent: 33.33 },
        { memberId: 'b', percent: 66.67 },
      ],
    });
    expect(parts.map((p) => p.owedCents)).toEqual([3_333, 6_667]);
  });

  it('rechaza lo pagado que no suma el total', () => {
    expect(() =>
      resolveTripExpense({
        totalCents: 10_000,
        payers: [
          { memberId: 'a', amountCents: 4_000 },
          { memberId: 'b', amountCents: 4_000 },
        ],
        mode: 'equal',
        participants: [{ memberId: 'a' }, { memberId: 'b' }],
      }),
    ).toThrow(/no alcanza/);
  });

  it('rechaza a alguien repetido', () => {
    expect(() =>
      resolveTripExpense({
        totalCents: 10_000,
        payers: [{ memberId: 'a', amountCents: 10_000 }],
        mode: 'equal',
        participants: [{ memberId: 'b' }, { memberId: 'b' }],
      }),
    ).toThrow(TripError);
  });
});

describe('convertToBase', () => {
  it('convierte euros a pesos con la tasa del viaje', () => {
    expect(convertToBase(EUR(12.5), 'EUR', 'COP', { EUR: 4500 })).toBe(5_625_000);
    expect(convertToBase(5_000, 'COP', 'COP', {})).toBe(5_000);
  });

  it('sin tasa no inventa una', () => {
    expect(() => convertToBase(100, 'GBP', 'COP', { EUR: 4500 })).toThrow(/GBP/);
  });
});

describe('computeTripBalances y simplifyDebts', () => {
  const miembros = ['camilo', 'andres', 'leo', 'edxa'];

  it('del ejemplo del Camp Nou salen tres transferencias a Camilo', () => {
    const parts = resolveTripExpense({
      totalCents: EUR(400),
      payers: [{ memberId: 'camilo', amountCents: EUR(400) }],
      mode: 'equal',
      participants: miembros.map((memberId) => ({ memberId })),
    });

    const balances = computeTripBalances({
      memberIds: miembros,
      baseCurrency: 'EUR',
      rates: {},
      expenses: [{ currency: 'EUR', totalCents: EUR(400), parts }],
    });

    expect(balances.map((b) => b.balanceCents)).toEqual([EUR(300), EUR(-100), EUR(-100), EUR(-100)]);
    expect(simplifyDebts(balances)).toEqual([
      { fromId: 'andres', toId: 'camilo', amountCents: EUR(100) },
      { fromId: 'leo', toId: 'camilo', amountCents: EUR(100) },
      { fromId: 'edxa', toId: 'camilo', amountCents: EUR(100) },
    ]);
  });

  it('cruza gastos en dos monedas y los saldos siempre suman cero', () => {
    const rates = { EUR: 4512.37 };
    const expenses = [
      {
        currency: 'EUR',
        totalCents: 10_001,
        parts: resolveTripExpense({
          totalCents: 10_001,
          payers: [{ memberId: 'camilo', amountCents: 10_001 }],
          mode: 'equal',
          participants: [{ memberId: 'camilo' }, { memberId: 'andres' }, { memberId: 'leo' }],
        }),
      },
      {
        currency: 'COP',
        totalCents: 30_000_000,
        parts: resolveTripExpense({
          totalCents: 30_000_000,
          payers: [{ memberId: 'leo', amountCents: 30_000_000 }],
          mode: 'equal',
          participants: miembros.map((memberId) => ({ memberId })),
        }),
      },
    ];

    const balances = computeTripBalances({ memberIds: miembros, baseCurrency: 'COP', rates, expenses });
    expect(balances.reduce((suma, b) => suma + b.balanceCents, 0)).toBe(0);

    const transfers = simplifyDebts(balances);
    expect(transfers.length).toBeLessThanOrEqual(miembros.length - 1);

    // Si todos hacen sus transferencias, todos quedan en cero.
    const after = computeTripBalances({
      memberIds: miembros,
      baseCurrency: 'COP',
      rates,
      expenses,
      settlements: transfers,
    });
    expect(after.every((b) => b.balanceCents === 0)).toBe(true);
  });

  it('un pago registrado baja la deuda', () => {
    const parts = resolveTripExpense({
      totalCents: 20_000,
      payers: [{ memberId: 'camilo', amountCents: 20_000 }],
      mode: 'equal',
      participants: [{ memberId: 'camilo' }, { memberId: 'leo' }],
    });

    const balances = computeTripBalances({
      memberIds: ['camilo', 'leo'],
      baseCurrency: 'EUR',
      rates: {},
      expenses: [{ currency: 'EUR', totalCents: 20_000, parts }],
      settlements: [{ fromId: 'leo', toId: 'camilo', amountCents: 4_000 }],
    });

    expect(balances.find((b) => b.memberId === 'leo')?.balanceCents).toBe(-6_000);
    expect(simplifyDebts(balances)).toEqual([{ fromId: 'leo', toId: 'camilo', amountCents: 6_000 }]);
  });

  it('nadie le paga a quien le debe: las deudas en cadena se acortan', () => {
    // A le debe 10 a B y B le debe 10 a C: basta con que A le pague a C.
    const transfers = simplifyDebts([
      { memberId: 'a', balanceCents: -1_000 },
      { memberId: 'b', balanceCents: 0 },
      { memberId: 'c', balanceCents: 1_000 },
    ]);
    expect(transfers).toEqual([{ fromId: 'a', toId: 'c', amountCents: 1_000 }]);
  });
});
