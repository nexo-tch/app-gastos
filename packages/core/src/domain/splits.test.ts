import { describe, expect, it } from 'vitest';
import { sumCents } from '../money.js';
import { ME, computeMyShare, resolveSplitPlan } from './splits.js';

describe('resolveSplitPlan en partes iguales', () => {
  it('divide entre yo y otra persona', () => {
    const result = resolveSplitPlan(100_000_00, { mode: 'equal', personIds: ['ana'] });
    expect(result.myShareCents).toBe(50_000_00);
    expect(result.splits).toEqual([{ personId: 'ana', amountCents: 50_000_00 }]);
  });

  it('no pierde centavos cuando la division es inexacta', () => {
    const result = resolveSplitPlan(100_01, { mode: 'equal', personIds: ['ana', 'luis'] });
    const total = result.myShareCents + sumCents(result.splits.map((s) => s.amountCents));
    expect(total).toBe(100_01);
  });

  it('permite pagar algo que no consumo', () => {
    const result = resolveSplitPlan(60_000_00, {
      mode: 'equal',
      personIds: ['ana', 'luis'],
      includeMe: false,
    });
    expect(result.myShareCents).toBe(0);
    expect(result.splits).toHaveLength(2);
  });
});

describe('resolveSplitPlan por montos', () => {
  it('deja a mi cargo lo que nadie reclama', () => {
    const result = resolveSplitPlan(100_000_00, {
      mode: 'amounts',
      entries: [{ participantId: 'ana', amountCents: 30_000_00 }],
    });
    expect(result.myShareCents).toBe(70_000_00);
  });

  it('rechaza repartos que superan el total', () => {
    expect(() =>
      resolveSplitPlan(50_000_00, {
        mode: 'amounts',
        entries: [{ participantId: 'ana', amountCents: 60_000_00 }],
      }),
    ).toThrow(/supera el total/);
  });

  it('rechaza un participante repetido', () => {
    expect(() =>
      resolveSplitPlan(50_000_00, {
        mode: 'amounts',
        entries: [
          { participantId: 'ana', amountCents: 10_000_00 },
          { participantId: 'ana', amountCents: 10_000_00 },
        ],
      }),
    ).toThrow(/dos veces/);
  });
});

describe('resolveSplitPlan por porcentaje', () => {
  it('reparte 70/30 con yo incluido', () => {
    const result = resolveSplitPlan(200_000_00, {
      mode: 'percent',
      entries: [
        { participantId: ME, percent: 70 },
        { participantId: 'ana', percent: 30 },
      ],
    });
    expect(result.myShareCents).toBe(140_000_00);
    expect(result.splits[0]?.amountCents).toBe(60_000_00);
  });

  it('me deja el resto si los porcentajes no llegan a 100', () => {
    const result = resolveSplitPlan(100_000_00, {
      mode: 'percent',
      entries: [{ participantId: 'ana', percent: 40 }],
    });
    expect(result.myShareCents).toBe(60_000_00);
  });

  it('rechaza mas de 100%', () => {
    expect(() =>
      resolveSplitPlan(100_000_00, {
        mode: 'percent',
        entries: [
          { participantId: 'ana', percent: 60 },
          { participantId: 'luis', percent: 60 },
        ],
      }),
    ).toThrow(/mas de 100/);
  });
});

describe('computeMyShare', () => {
  it('resta la parte de los demas del total', () => {
    expect(computeMyShare(100_000_00, [{ amountCents: 40_000_00 }])).toBe(60_000_00);
  });

  it('falla si los repartos superan el total', () => {
    expect(() => computeMyShare(10_000_00, [{ amountCents: 20_000_00 }])).toThrow();
  });
});
