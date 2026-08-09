/**
 * El dinero SIEMPRE viaja como entero en unidades minimas (centavos).
 * Ninguna operacion de este modulo debe producir flotantes.
 */

export type Cents = number;

export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertCents(value: number, label = 'monto'): Cents {
  if (!Number.isFinite(value)) throw new MoneyError(`${label} no es un numero finito`);
  if (!Number.isInteger(value)) throw new MoneyError(`${label} debe ser entero en centavos, recibido ${value}`);
  if (Math.abs(value) > MAX_SAFE_CENTS) throw new MoneyError(`${label} excede el rango seguro`);
  return value;
}

/**
 * Convierte un valor decimal escrito por el usuario (45000.5) a centavos (4500050).
 *
 * Se normaliza el resultado antes de redondear porque la multiplicacion en
 * binario desvia el valor: `1.005 * 100` da 100.49999999999999 y se redondearia
 * a 100 centavos en vez de 101.
 */
export function toCents(amount: number, decimals = 2): Cents {
  if (!Number.isFinite(amount)) throw new MoneyError('monto invalido');
  const factor = 10 ** decimals;
  const scaled = Number((amount * factor).toFixed(6));
  return Math.round(scaled);
}

export function fromCents(cents: Cents, decimals = 2): number {
  return cents / 10 ** decimals;
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce<Cents>((acc, v) => acc + v, 0);
}

/**
 * Reparte `total` en partes proporcionales a `weights` sin perder ni inventar centavos.
 * Usa el metodo del resto mayor: la suma del resultado es exactamente `total`.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total, 'total a repartir');
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0)) throw new MoneyError('los pesos no pueden ser negativos');

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) throw new MoneyError('la suma de pesos debe ser mayor que cero');

  const exact = weights.map((w) => (total * w) / totalWeight);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  // El centavo sobrante va a quien tenga mayor parte fraccionaria; ante empate, al primero.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  const result = [...floors];
  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    const target = order[cursor % order.length]!;
    result[target.index] = result[target.index]! + 1;
    remainder -= 1;
    cursor += 1;
  }
  return result;
}

/** Reparte en partes iguales entre `parts` participantes. */
export function splitEvenly(total: Cents, parts: number): Cents[] {
  if (!Number.isInteger(parts) || parts <= 0) throw new MoneyError('el numero de partes debe ser un entero positivo');
  return allocate(total, new Array<number>(parts).fill(1));
}

/** Porcentaje de un total, redondeado a centavo. `percent` va de 0 a 100. */
export function percentOf(total: Cents, percent: number): Cents {
  if (!Number.isFinite(percent)) throw new MoneyError('porcentaje invalido');
  return Math.round((total * percent) / 100);
}

export function ratio(part: Cents, whole: Cents): number {
  if (whole === 0) return part === 0 ? 0 : Infinity;
  return part / whole;
}

export function clampToZero(value: Cents): Cents {
  return value < 0 ? 0 : value;
}

export interface FormatMoneyOptions {
  locale?: string;
  currency?: string;
  decimals?: number;
  /** COP no se usa con decimales en la practica. */
  hideDecimals?: boolean;
  showSign?: boolean;
}

export function formatMoney(cents: Cents, options: FormatMoneyOptions = {}): string {
  const {
    locale = 'es-CO',
    currency = 'COP',
    decimals = 2,
    hideDecimals = currency === 'COP',
    showSign = false,
  } = options;

  const value = fromCents(cents, decimals);
  const fractionDigits = hideDecimals ? 0 : decimals;

  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

  if (showSign && cents > 0) return `+${formatted}`;
  return formatted;
}

/** Version compacta para tarjetas y graficos: $1,2 M */
export function formatMoneyCompact(cents: Cents, options: FormatMoneyOptions = {}): string {
  const { locale = 'es-CO', currency = 'COP', decimals = 2 } = options;
  const value = fromCents(cents, decimals);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
