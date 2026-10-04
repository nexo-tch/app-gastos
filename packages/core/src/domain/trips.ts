import { allocate, assertCents, sumCents, type Cents } from '../money.js';

/**
 * Viajes en grupo: varias personas, cada una con su cuenta en la app, cargan
 * gastos en una misma bolsa y el motor dice quién le debe a quién.
 *
 * Es aparte del presupuesto personal a propósito. Aquí no hay "mi parte" que
 * entre en un mes: cada gasto se reparte entre miembros del viaje y lo único
 * que importa es el saldo de cada uno al final.
 *
 * Un gasto puede estar en cualquier moneda. Para sumar se convierte a la
 * moneda base del viaje con una tasa fija que el grupo acuerda, no con la del
 * día: así el saldo no se mueve solo y todos ven la misma cifra.
 */

export const TRIP_CURRENCIES = ['EUR', 'COP', 'USD', 'GBP', 'CHF'] as const;
export type TripCurrency = (typeof TRIP_CURRENCIES)[number];

export const TRIP_CATEGORIES = [
  { id: 'comida', name: 'Comida y bebida', color: '#E2653C' },
  { id: 'hospedaje', name: 'Hospedaje', color: '#2D7FA8' },
  { id: 'transporte', name: 'Transporte', color: '#12A08D' },
  { id: 'actividades', name: 'Entradas y tours', color: '#9C4BC4' },
  { id: 'compras', name: 'Compras', color: '#D68B1C' },
  { id: 'mercado', name: 'Mercado', color: '#4A9D5B' },
  { id: 'otros', name: 'Otros', color: '#7A7B72' },
] as const;
export type TripCategoryId = (typeof TRIP_CATEGORIES)[number]['id'];

export type TripSplitMode = 'equal' | 'amounts' | 'percent';

export class TripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripError';
  }
}

export interface TripPayerInput {
  memberId: string;
  amountCents: Cents;
}

export interface TripParticipantInput {
  memberId: string;
  /** Solo en modo `amounts`. */
  amountCents?: Cents;
  /** Solo en modo `percent`. */
  percent?: number;
}

export interface TripExpenseInput {
  totalCents: Cents;
  payers: readonly TripPayerInput[];
  mode: TripSplitMode;
  participants: readonly TripParticipantInput[];
}

/** Una fila por miembro que pagó, consumió, o las dos cosas. */
export interface TripExpensePart {
  memberId: string;
  paidCents: Cents;
  owedCents: Cents;
}

/**
 * Valida un gasto y lo baja a partes exactas.
 *
 * A diferencia del reparto personal, aquí no hay a quién cargarle lo que
 * sobra: lo pagado tiene que sumar el total, y en montos o porcentajes lo
 * repartido también. Si no cuadra se rechaza, porque un centavo sin dueño en
 * un gasto de grupo termina siendo una discusión.
 */
export function resolveTripExpense(input: TripExpenseInput): TripExpensePart[] {
  const { totalCents } = input;
  assertCents(totalCents, 'total del gasto');
  if (totalCents <= 0) throw new TripError('El gasto tiene que ser mayor que cero');

  if (input.payers.length === 0) throw new TripError('Falta quién pagó');
  assertUnique(input.payers.map((p) => p.memberId), 'pagó');
  for (const payer of input.payers) {
    assertCents(payer.amountCents, 'monto pagado');
    if (payer.amountCents < 0) throw new TripError('Nadie puede pagar un monto negativo');
  }
  const paid = sumCents(input.payers.map((p) => p.amountCents));
  if (paid !== totalCents) {
    throw new TripError(
      paid < totalCents
        ? 'Lo pagado no alcanza el total del gasto'
        : 'Lo pagado supera el total del gasto',
    );
  }

  if (input.participants.length === 0) throw new TripError('Elige entre quiénes se reparte');
  const memberIds = input.participants.map((p) => p.memberId);
  assertUnique(memberIds, 'participa');

  const owed = owedAmounts(totalCents, input.mode, input.participants);

  const parts = new Map<string, TripExpensePart>();
  const part = (memberId: string) => {
    let existing = parts.get(memberId);
    if (!existing) {
      existing = { memberId, paidCents: 0, owedCents: 0 };
      parts.set(memberId, existing);
    }
    return existing;
  };

  input.payers.forEach((payer) => {
    if (payer.amountCents > 0) part(payer.memberId).paidCents += payer.amountCents;
  });
  input.participants.forEach((participant, index) => {
    part(participant.memberId).owedCents += owed[index] ?? 0;
  });

  return [...parts.values()];
}

function owedAmounts(
  totalCents: Cents,
  mode: TripSplitMode,
  participants: readonly TripParticipantInput[],
): Cents[] {
  switch (mode) {
    case 'equal':
      return allocate(totalCents, participants.map(() => 1));

    case 'amounts': {
      const amounts = participants.map((p) => {
        const amount = p.amountCents ?? 0;
        assertCents(amount, 'monto del participante');
        if (amount < 0) throw new TripError('Ningún participante puede tener un monto negativo');
        return amount;
      });
      const assigned = sumCents(amounts);
      if (assigned !== totalCents) {
        throw new TripError(
          assigned < totalCents
            ? 'Lo repartido no alcanza el total del gasto'
            : 'Lo repartido supera el total del gasto',
        );
      }
      return amounts;
    }

    case 'percent': {
      const percents = participants.map((p) => {
        const percent = p.percent ?? 0;
        if (!Number.isFinite(percent) || percent < 0) throw new TripError('Porcentaje inválido');
        return percent;
      });
      const totalPercent = percents.reduce((a, b) => a + b, 0);
      if (Math.abs(totalPercent - 100) > 0.0001) {
        throw new TripError(`Los porcentajes suman ${round2(totalPercent)}%, no 100%`);
      }
      return allocate(totalCents, percents);
    }

    default:
      throw new TripError('Forma de reparto desconocida');
  }
}

/* ── Monedas ─────────────────────────────────────────────────────── */

/**
 * Cuántas unidades de la moneda base vale una unidad de cada otra moneda.
 * Con base COP y `{ EUR: 4500 }`, un euro son 4.500 pesos.
 */
export type TripRates = Readonly<Record<string, number>>;

export function rateFor(currency: string, baseCurrency: string, rates: TripRates): number {
  if (currency === baseCurrency) return 1;
  const rate = rates[currency];
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    throw new TripError(`Falta la tasa de ${currency} a ${baseCurrency}`);
  }
  return rate;
}

/** Los dos montos van en centavos, así que la tasa se aplica tal cual. */
export function convertToBase(
  amountCents: Cents,
  currency: string,
  baseCurrency: string,
  rates: TripRates,
): Cents {
  assertCents(amountCents, 'monto a convertir');
  return Math.round(amountCents * rateFor(currency, baseCurrency, rates));
}

/* ── Saldos ──────────────────────────────────────────────────────── */

export interface TripExpenseForBalance {
  currency: string;
  totalCents: Cents;
  parts: readonly TripExpensePart[];
}

/** Plata que pasó de un miembro a otro para saldar, siempre en moneda base. */
export interface TripSettlement {
  fromId: string;
  toId: string;
  amountCents: Cents;
}

export interface TripMemberBalance {
  memberId: string;
  /** Lo que puso de su bolsillo en gastos. */
  paidCents: Cents;
  /** Lo que le tocaba de esos gastos. */
  owedCents: Cents;
  /** Pagos para saldar: lo que entregó menos lo que recibió. */
  settledCents: Cents;
  /** Positivo: le deben. Negativo: debe. */
  balanceCents: Cents;
}

/**
 * El saldo de cada miembro en la moneda base.
 *
 * Cada gasto se convierte entero y después se reparte con el método del resto
 * mayor, en vez de convertir cada parte por separado: si no, el redondeo de
 * cada parte deja centavos sueltos y los saldos dejan de sumar cero.
 */
export function computeTripBalances(input: {
  memberIds: readonly string[];
  baseCurrency: string;
  rates: TripRates;
  expenses: readonly TripExpenseForBalance[];
  settlements?: readonly TripSettlement[];
}): TripMemberBalance[] {
  const balances = new Map<string, TripMemberBalance>();
  const entry = (memberId: string) => {
    let existing = balances.get(memberId);
    if (!existing) {
      existing = { memberId, paidCents: 0, owedCents: 0, settledCents: 0, balanceCents: 0 };
      balances.set(memberId, existing);
    }
    return existing;
  };
  input.memberIds.forEach(entry);

  for (const expense of input.expenses) {
    const baseTotal = convertToBase(expense.totalCents, expense.currency, input.baseCurrency, input.rates);
    const paid = sumCents(expense.parts.map((p) => p.paidCents));
    const owed = sumCents(expense.parts.map((p) => p.owedCents));
    if (paid !== expense.totalCents || owed !== expense.totalCents) {
      throw new TripError('Un gasto del viaje no cuadra con su total');
    }

    const basePaid = allocate(baseTotal, expense.parts.map((p) => p.paidCents));
    const baseOwed = allocate(baseTotal, expense.parts.map((p) => p.owedCents));
    expense.parts.forEach((part, index) => {
      const member = entry(part.memberId);
      member.paidCents += basePaid[index] ?? 0;
      member.owedCents += baseOwed[index] ?? 0;
    });
  }

  for (const settlement of input.settlements ?? []) {
    assertCents(settlement.amountCents, 'pago');
    entry(settlement.fromId).settledCents += settlement.amountCents;
    entry(settlement.toId).settledCents -= settlement.amountCents;
  }

  for (const member of balances.values()) {
    member.balanceCents = member.paidCents - member.owedCents + member.settledCents;
  }

  return [...balances.values()];
}

export interface TripTransfer {
  fromId: string;
  toId: string;
  amountCents: Cents;
}

/**
 * Las transferencias que dejan a todos en cero, con las menos posibles en la
 * práctica: el que más debe le paga al que más le deben, y se repite.
 *
 * No siempre da el mínimo absoluto (ese problema es NP-difícil), pero con un
 * grupo de viaje nunca sobran más de n-1 transferencias y nadie le paga a
 * alguien que a su vez le debe.
 */
export function simplifyDebts(balances: readonly Pick<TripMemberBalance, 'memberId' | 'balanceCents'>[]): TripTransfer[] {
  const order = new Map(balances.map((b, index) => [b.memberId, index]));
  const byAmount = (a: { memberId: string; cents: number }, b: { memberId: string; cents: number }) =>
    b.cents - a.cents || order.get(a.memberId)! - order.get(b.memberId)!;

  const creditors = balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({ memberId: b.memberId, cents: b.balanceCents }));
  const debtors = balances
    .filter((b) => b.balanceCents < 0)
    .map((b) => ({ memberId: b.memberId, cents: -b.balanceCents }));

  const transfers: TripTransfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmount);
    debtors.sort(byAmount);
    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = Math.min(creditor.cents, debtor.cents);

    transfers.push({ fromId: debtor.memberId, toId: creditor.memberId, amountCents: amount });
    creditor.cents -= amount;
    debtor.cents -= amount;
    if (creditor.cents === 0) creditors.shift();
    if (debtor.cents === 0) debtors.shift();
  }

  return transfers;
}

/**
 * Lo máximo que `fromId` le puede pagar a `toId` sin que nadie quede debiendo
 * al revés: no más de lo que debe quien paga, ni de lo que le deben a quien
 * recibe. No tiene que ser una de las transferencias sugeridas: alguien puede
 * pagarle a otro por fuera de lo que propone la app, mientras no se pase.
 */
export function maxSettlementCents(
  balances: readonly Pick<TripMemberBalance, 'memberId' | 'balanceCents'>[],
  fromId: string,
  toId: string,
): Cents {
  if (fromId === toId) return 0;
  const owes = -(balances.find((b) => b.memberId === fromId)?.balanceCents ?? 0);
  const owed = balances.find((b) => b.memberId === toId)?.balanceCents ?? 0;
  return Math.max(0, Math.min(owes, owed));
}

function assertUnique(ids: readonly string[], verb: string): void {
  const seen = new Set<string>();
  for (const memberId of ids) {
    if (seen.has(memberId)) throw new TripError(`Alguien aparece dos veces en quién ${verb}`);
    seen.add(memberId);
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;
