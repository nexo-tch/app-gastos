/**
 * Utilidades de fecha centradas en "meses de presupuesto".
 *
 * Colombia no tiene horario de verano, asi que en vez de arrastrar una libreria
 * de zonas horarias trabajamos con un desfase UTC fijo y configurable. Todo lo
 * que se persiste es un instante ISO en UTC; el mes al que pertenece un gasto se
 * decide siempre con el desfase local del usuario.
 */

export type MonthKey = `${number}-${string}`;
export type DayKey = string;

export const DEFAULT_UTC_OFFSET = '-05:00';

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

export class DateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateRangeError';
  }
}

export function parseOffsetMinutes(offset: string = DEFAULT_UTC_OFFSET): number {
  const match = OFFSET_RE.exec(offset);
  if (!match) throw new DateRangeError(`Desfase UTC invalido: ${offset}`);
  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}

function toInstant(value: Date | string): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new DateRangeError(`Fecha invalida: ${String(value)}`);
  return date;
}

/**
 * Devuelve un Date cuyos getters UTC entregan los componentes de la hora local.
 * Solo debe usarse para leer partes de la fecha, nunca para persistir.
 */
function shiftToLocal(value: Date | string, offset: string): Date {
  const instant = toInstant(value);
  return new Date(instant.getTime() + parseOffsetMinutes(offset) * 60_000);
}

export function isMonthKey(value: string): value is MonthKey {
  return MONTH_KEY_RE.test(value);
}

export function assertMonthKey(value: string): MonthKey {
  if (!isMonthKey(value)) throw new DateRangeError(`Mes invalido, se esperaba YYYY-MM y llego: ${value}`);
  return value;
}

export function monthKeyOf(value: Date | string, offset: string = DEFAULT_UTC_OFFSET): MonthKey {
  const local = shiftToLocal(value, offset);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}` as MonthKey;
}

export function dayKeyOf(value: Date | string, offset: string = DEFAULT_UTC_OFFSET): DayKey {
  const local = shiftToLocal(value, offset);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dayOfMonthOf(value: Date | string, offset: string = DEFAULT_UTC_OFFSET): number {
  return shiftToLocal(value, offset).getUTCDate();
}

export function splitMonthKey(month: MonthKey): { year: number; month: number } {
  assertMonthKey(month);
  const [year, monthPart] = month.split('-');
  return { year: Number(year), month: Number(monthPart) };
}

export function daysInMonth(month: MonthKey): number {
  const { year, month: m } = splitMonthKey(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** Instante UTC en el que empieza el mes local. */
export function startOfMonth(month: MonthKey, offset: string = DEFAULT_UTC_OFFSET): Date {
  const { year, month: m } = splitMonthKey(month);
  return new Date(Date.UTC(year, m - 1, 1) - parseOffsetMinutes(offset) * 60_000);
}

/** Instante UTC en el que empieza el mes siguiente (limite superior exclusivo). */
export function endOfMonthExclusive(month: MonthKey, offset: string = DEFAULT_UTC_OFFSET): Date {
  return startOfMonth(addMonths(month, 1), offset);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const { year, month: m } = splitMonthKey(month);
  const zeroBased = year * 12 + (m - 1) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, '0')}` as MonthKey;
}

export function isWithinMonth(
  value: Date | string,
  month: MonthKey,
  offset: string = DEFAULT_UTC_OFFSET,
): boolean {
  return monthKeyOf(value, offset) === month;
}

/**
 * Dia del mes ya transcurrido, acotado al total de dias.
 * Si `now` cae fuera del mes, devuelve 0 (mes futuro) o el total (mes pasado).
 */
export function elapsedDaysInMonth(
  month: MonthKey,
  now: Date | string,
  offset: string = DEFAULT_UTC_OFFSET,
): number {
  const total = daysInMonth(month);
  const current = monthKeyOf(now, offset);
  if (current < month) return 0;
  if (current > month) return total;
  return Math.min(dayOfMonthOf(now, offset), total);
}

/** Ajusta un dia de corte (por ejemplo 31) al ultimo dia disponible del mes. */
export function clampDayToMonth(month: MonthKey, day: number): number {
  const total = daysInMonth(month);
  if (day < 1) return 1;
  return Math.min(day, total);
}

/** Instante UTC del dia `day` del mes, a las 00:00 locales. */
export function dateInMonth(
  month: MonthKey,
  day: number,
  offset: string = DEFAULT_UTC_OFFSET,
): Date {
  const { year, month: m } = splitMonthKey(month);
  const safeDay = clampDayToMonth(month, day);
  return new Date(Date.UTC(year, m - 1, safeDay) - parseOffsetMinutes(offset) * 60_000);
}

export function minutesBetween(a: Date | string, b: Date | string): number {
  return Math.abs(toInstant(a).getTime() - toInstant(b).getTime()) / 60_000;
}

export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.abs(toInstant(a).getTime() - toInstant(b).getTime()) / 86_400_000;
}

export function toIso(value: Date | string): string {
  return toInstant(value).toISOString();
}
