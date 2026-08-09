import { sumCents, type Cents } from '../money.js';
import type { OwedShare } from './types.js';

/**
 * El lado contrario de `debts.ts`.
 *
 * Ahi se calcula lo que me deben, que sale de mis gastos y de como los reparti.
 * Aqui se calcula lo que yo debo, que no sale de ningun gasto mio: es la parte
 * que me toca de algo que pago otra persona, y de eso solo se sabe lo que ella
 * me cuente. Por eso es una lista propia y no un reparto con el signo cambiado.
 *
 * Se paga entero o no se paga: no hay abonos parciales de este lado. Cada
 * deuda es la parte de un gasto concreto, y decir "de ese gasto pague la
 * mitad" no le sirve a nadie.
 */

export interface PersonOwedSummary {
  personId: string;
  pendingCents: Cents;
  settledCents: Cents;
  pendingItemCount: number;
  oldestPendingAt: string | null;
  items: OwedShare[];
}

export interface OwedOverview {
  totalPendingCents: Cents;
  byPerson: PersonOwedSummary[];
}

export function computeOwed(shares: readonly OwedShare[]): OwedOverview {
  const byPerson = new Map<string, PersonOwedSummary>();

  for (const share of shares) {
    let summary = byPerson.get(share.personId);
    if (!summary) {
      summary = {
        personId: share.personId,
        pendingCents: 0,
        settledCents: 0,
        pendingItemCount: 0,
        oldestPendingAt: null,
        items: [],
      };
      byPerson.set(share.personId, summary);
    }

    summary.items.push(share);

    if (share.settledAt) {
      summary.settledCents += share.amountCents;
      continue;
    }

    summary.pendingCents += share.amountCents;
    summary.pendingItemCount += 1;
    if (summary.oldestPendingAt === null || share.occurredAt < summary.oldestPendingAt) {
      summary.oldestPendingAt = share.occurredAt;
    }
  }

  const people = Array.from(byPerson.values()).map((summary) => {
    summary.items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return summary;
  });

  people.sort((a, b) => b.pendingCents - a.pendingCents);

  return {
    totalPendingCents: sumCents(people.map((p) => p.pendingCents)),
    byPerson: people,
  };
}
