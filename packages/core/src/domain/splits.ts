import { allocate, assertCents, percentOf, sumCents, type Cents } from '../money.js';

/** `null` representa siempre "yo": no soy una fila de la tabla de personas. */
export const ME = null;
export type ParticipantId = string | null;

export interface SplitPlanEqual {
  mode: 'equal';
  /** Personas distintas a mi que participan. */
  personIds: readonly string[];
  /** Si soy parte del reparto. Un gasto que pago pero no consumo va en false. */
  includeMe?: boolean;
}

export interface SplitPlanAmounts {
  mode: 'amounts';
  entries: ReadonlyArray<{ participantId: ParticipantId; amountCents: Cents }>;
}

export interface SplitPlanPercent {
  mode: 'percent';
  entries: ReadonlyArray<{ participantId: ParticipantId; percent: number }>;
}

export type SplitPlan = SplitPlanEqual | SplitPlanAmounts | SplitPlanPercent;

export interface ResolvedSplit {
  personId: string;
  amountCents: Cents;
}

export interface ResolvedSplitPlan {
  myShareCents: Cents;
  splits: ResolvedSplit[];
}

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitError';
  }
}

/**
 * Convierte un plan de reparto en montos exactos.
 * La suma de mi parte mas la de los demas es siempre igual al total: los
 * centavos que no dividen exacto se reparten con el metodo del resto mayor.
 */
export function resolveSplitPlan(totalCents: Cents, plan: SplitPlan): ResolvedSplitPlan {
  assertCents(totalCents, 'total del gasto');
  if (totalCents < 0) throw new SplitError('El total del gasto no puede ser negativo');

  switch (plan.mode) {
    case 'equal':
      return resolveEqual(totalCents, plan);
    case 'amounts':
      return resolveAmounts(totalCents, plan);
    case 'percent':
      return resolvePercent(totalCents, plan);
  }
}

function resolveEqual(totalCents: Cents, plan: SplitPlanEqual): ResolvedSplitPlan {
  const includeMe = plan.includeMe ?? true;
  const uniquePeople = dedupePersonIds(plan.personIds);
  const participants: ParticipantId[] = includeMe ? [ME, ...uniquePeople] : [...uniquePeople];

  if (participants.length === 0) {
    throw new SplitError('Un reparto en partes iguales necesita al menos un participante');
  }

  const amounts = allocate(totalCents, participants.map(() => 1));
  return assemble(totalCents, participants, amounts);
}

function resolveAmounts(totalCents: Cents, plan: SplitPlanAmounts): ResolvedSplitPlan {
  if (plan.entries.length === 0) throw new SplitError('El reparto por montos necesita al menos una entrada');

  const participants = plan.entries.map((entry) => entry.participantId);
  assertUniqueParticipants(participants);

  const amounts = plan.entries.map((entry) => {
    assertCents(entry.amountCents, 'monto del participante');
    if (entry.amountCents < 0) throw new SplitError('Ningun participante puede tener un monto negativo');
    return entry.amountCents;
  });

  const assigned = sumCents(amounts);
  if (assigned > totalCents) {
    throw new SplitError(
      `El reparto (${assigned}) supera el total del gasto (${totalCents})`,
    );
  }

  const result = assemble(totalCents, participants, amounts);
  // Lo que nadie reclamo queda a mi cargo: es mi gasto y yo lo pague.
  result.myShareCents = totalCents - sumCents(result.splits.map((s) => s.amountCents));
  return result;
}

function resolvePercent(totalCents: Cents, plan: SplitPlanPercent): ResolvedSplitPlan {
  if (plan.entries.length === 0) throw new SplitError('El reparto por porcentaje necesita al menos una entrada');

  const participants = plan.entries.map((entry) => entry.participantId);
  assertUniqueParticipants(participants);

  const percents = plan.entries.map((entry) => {
    if (!Number.isFinite(entry.percent) || entry.percent < 0) {
      throw new SplitError('Porcentaje invalido en el reparto');
    }
    return entry.percent;
  });

  const totalPercent = percents.reduce((a, b) => a + b, 0);
  if (totalPercent > 100.0001) {
    throw new SplitError(`Los porcentajes suman ${totalPercent}%, mas de 100%`);
  }

  // Si los porcentajes no llegan a 100, el resto es mio.
  const covered = percentOf(totalCents, totalPercent);
  const amounts = allocate(covered, percents);
  const result = assemble(totalCents, participants, amounts);
  result.myShareCents = totalCents - sumCents(result.splits.map((s) => s.amountCents));
  return result;
}

function assemble(
  totalCents: Cents,
  participants: readonly ParticipantId[],
  amounts: readonly Cents[],
): ResolvedSplitPlan {
  const splits: ResolvedSplit[] = [];
  let myShareCents = 0;

  participants.forEach((participantId, index) => {
    const amount = amounts[index] ?? 0;
    if (participantId === ME) {
      myShareCents += amount;
      return;
    }
    splits.push({ personId: participantId, amountCents: amount });
  });

  const othersTotal = sumCents(splits.map((s) => s.amountCents));
  if (othersTotal + myShareCents !== totalCents) {
    // Cualquier descuadre se absorbe en mi parte antes que perder centavos.
    myShareCents = totalCents - othersTotal;
  }

  return { myShareCents, splits };
}

/**
 * Mi parte a partir de los splits ya guardados. Es la unica fuente de verdad
 * para el presupuesto: nunca se debe usar `amountTotalCents`.
 */
export function computeMyShare(
  totalCents: Cents,
  splits: ReadonlyArray<{ amountCents: Cents }>,
): Cents {
  const others = sumCents(splits.map((s) => s.amountCents));
  if (others > totalCents) {
    throw new SplitError(
      `Los repartos (${others}) superan el total del gasto (${totalCents})`,
    );
  }
  return totalCents - others;
}

export function isShared(splits: ReadonlyArray<unknown>): boolean {
  return splits.length > 0;
}

function dedupePersonIds(personIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const personId of personIds) {
    if (seen.has(personId)) continue;
    seen.add(personId);
    result.push(personId);
  }
  return result;
}

function assertUniqueParticipants(participants: readonly ParticipantId[]): void {
  const seen = new Set<string>();
  for (const participant of participants) {
    const key = participant ?? '__me__';
    if (seen.has(key)) {
      throw new SplitError(`El participante ${key} aparece dos veces en el reparto`);
    }
    seen.add(key);
  }
}
