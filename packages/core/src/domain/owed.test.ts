import { describe, expect, it } from 'vitest';
import type { OwedShare } from './types.js';
import { computeOwed } from './owed.js';

const deuda = (parcial: Partial<OwedShare> = {}): OwedShare => ({
  id: Math.random().toString(36).slice(2),
  personId: 'ana',
  amountCents: 30_000_00,
  description: 'Mercado',
  occurredAt: '2026-08-08T12:00:00-05:00',
  settledAt: null,
  ...parcial,
});

describe('computeOwed', () => {
  it('suma lo que le debo a cada persona', () => {
    const owed = computeOwed([
      deuda({ personId: 'ana', amountCents: 30_000_00 }),
      deuda({ personId: 'ana', amountCents: 20_000_00 }),
      deuda({ personId: 'carlos', amountCents: 10_000_00 }),
    ]);

    expect(owed.totalPendingCents).toBe(60_000_00);
    expect(owed.byPerson[0]?.personId).toBe('ana');
    expect(owed.byPerson[0]?.pendingCents).toBe(50_000_00);
    expect(owed.byPerson[0]?.pendingItemCount).toBe(2);
  });

  it('lo pagado deja de estar pendiente pero sigue en el historial', () => {
    const owed = computeOwed([
      deuda({ amountCents: 30_000_00, settledAt: '2026-08-09T12:00:00-05:00' }),
      deuda({ amountCents: 20_000_00 }),
    ]);

    expect(owed.totalPendingCents).toBe(20_000_00);
    expect(owed.byPerson[0]?.settledCents).toBe(30_000_00);
    expect(owed.byPerson[0]?.items).toHaveLength(2);
  });

  it('recuerda desde cuando se debe, que es lo que incomoda', () => {
    const owed = computeOwed([
      deuda({ occurredAt: '2026-08-08T12:00:00-05:00' }),
      deuda({ occurredAt: '2026-06-02T12:00:00-05:00' }),
      // Una vieja ya pagada no deberia contar como la mas antigua pendiente.
      deuda({ occurredAt: '2026-01-04T12:00:00-05:00', settledAt: '2026-02-01T12:00:00-05:00' }),
    ]);

    expect(owed.byPerson[0]?.oldestPendingAt).toBe('2026-06-02T12:00:00-05:00');
    expect(owed.byPerson[0]?.items[0]?.occurredAt).toBe('2026-08-08T12:00:00-05:00');
  });

  it('sin deudas no inventa personas', () => {
    expect(computeOwed([])).toEqual({ totalPendingCents: 0, byPerson: [] });
  });
});
