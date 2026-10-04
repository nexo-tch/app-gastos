import {
  TRIP_CATEGORIES,
  TRIP_CURRENCIES,
  TripError,
  computeTripBalances,
  formatMoney,
  maxSettlementCents,
  resolveTripExpense,
  type TripCategoryId,
} from '@gastos/core';
import { base, esquema } from '@gastos/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Viajes en grupo. Es lo unico de la app donde una cuenta ve y escribe filas
 * que no son suyas, asi que cada funcion empieza por lo mismo: comprobar que
 * quien pide es miembro del viaje. Y para cambiar o borrar un gasto, ademas,
 * que sea quien lo creo.
 *
 * Los ids los pone el servidor. En el estado personal los inventa el
 * navegador porque la app funciona sin senal; aqui no hace falta, y asi nadie
 * puede escoger el id de un gasto ajeno.
 */

export class ViajeError extends Error {
  constructor(
    readonly estado: 400 | 403 | 404,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const MAX_MIEMBROS = 20;
const OFFSET = '-05:00';

const nuevoId = () => randomBytes(9).toString('base64url');

/* ── Lo que llega del navegador ──────────────────────────────────── */

const moneda = z.enum(TRIP_CURRENCIES);
const idsCategorias = TRIP_CATEGORIES.map((c) => c.id) as [TripCategoryId, ...TripCategoryId[]];
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idUsuario = z.string().min(1).max(40);

export const tasasSchema = z.record(moneda, z.number().positive().max(10_000_000));

export const crearViajeSchema = z.object({
  nombre: z.string().trim().min(1).max(60),
  monedaBase: moneda,
  tasas: tasasSchema.default({}),
});

export const editarViajeSchema = z.object({
  nombre: z.string().trim().min(1).max(60).optional(),
  tasas: tasasSchema.optional(),
});

export const gastoViajeSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  descripcion: z.string().trim().min(1).max(80),
  categoria: z.enum(idsCategorias),
  moneda,
  montoTotal: z.number().int().positive().max(1_000_000_000_000),
  ocurrioEn: dia,
  modo: z.enum(['equal', 'amounts', 'percent']),
  pagadores: z
    .array(z.object({ usuarioId: idUsuario, monto: z.number().int().min(0) }))
    .min(1)
    .max(MAX_MIEMBROS),
  participantes: z
    .array(
      z.object({
        usuarioId: idUsuario,
        monto: z.number().int().min(0).optional(),
        porcentaje: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1)
    .max(MAX_MIEMBROS),
});

export const pagoViajeSchema = z.object({
  de: idUsuario,
  a: idUsuario,
  monto: z.number().int().positive().max(1_000_000_000_000),
  ocurrioEn: dia.optional(),
});

/* ── Lo que vuelve ───────────────────────────────────────────────── */

export interface ViajeCompleto {
  id: string;
  nombre: string;
  monedaBase: string;
  tasas: Record<string, number>;
  codigo: string;
  creadoPor: string;
  creadoEn: string;
  miembros: Array<{ id: string; nombre: string }>;
  gastos: Array<{
    id: string;
    creadoPor: string;
    descripcion: string;
    categoria: string;
    moneda: string;
    montoTotal: number;
    modo: string;
    ocurrioEn: string;
    partes: Array<{
      usuarioId: string;
      pagado: number;
      debe: number;
      participa: boolean;
      peso: number | null;
    }>;
  }>;
  pagos: Array<{
    id: string;
    de: string;
    a: string;
    monto: number;
    registradoPor: string;
    ocurrioEn: string;
  }>;
}

/* ── Lectura ─────────────────────────────────────────────────────── */

export async function listarViajes(usuarioId: string): Promise<ViajeCompleto[]> {
  const db = await base();
  const mios = await db
    .select({ viajeId: esquema.viajeMiembros.viajeId })
    .from(esquema.viajeMiembros)
    .where(eq(esquema.viajeMiembros.usuarioId, usuarioId));

  return armar(mios.map((m) => m.viajeId));
}

export async function leerViaje(usuarioId: string, viajeId: string): Promise<ViajeCompleto> {
  await exigirMiembro(usuarioId, viajeId);
  const [viaje] = await armar([viajeId]);
  if (!viaje) throw new ViajeError(404, 'No encontramos ese viaje.');
  return viaje;
}

async function armar(ids: string[]): Promise<ViajeCompleto[]> {
  if (ids.length === 0) return [];
  const db = await base();

  const [viajes, miembros, gastos, partes, pagos] = await Promise.all([
    db.select().from(esquema.viajes).where(inArray(esquema.viajes.id, ids)).orderBy(asc(esquema.viajes.creadoEn)),
    db
      .select({
        viajeId: esquema.viajeMiembros.viajeId,
        id: esquema.usuarios.id,
        nombre: esquema.usuarios.nombre,
      })
      .from(esquema.viajeMiembros)
      .innerJoin(esquema.usuarios, eq(esquema.usuarios.id, esquema.viajeMiembros.usuarioId))
      .where(inArray(esquema.viajeMiembros.viajeId, ids))
      .orderBy(asc(esquema.viajeMiembros.unidoEn)),
    db
      .select()
      .from(esquema.viajeGastos)
      .where(inArray(esquema.viajeGastos.viajeId, ids))
      .orderBy(asc(esquema.viajeGastos.ocurrioEn), asc(esquema.viajeGastos.creadoEn)),
    db.select().from(esquema.viajePartes).where(inArray(esquema.viajePartes.viajeId, ids)),
    db
      .select()
      .from(esquema.viajePagos)
      .where(inArray(esquema.viajePagos.viajeId, ids))
      .orderBy(asc(esquema.viajePagos.ocurrioEn), asc(esquema.viajePagos.creadoEn)),
  ]);

  return viajes.map((viaje) => ({
    id: viaje.id,
    nombre: viaje.nombre,
    monedaBase: viaje.monedaBase,
    tasas: leerTasas(viaje.tasas),
    codigo: viaje.codigo,
    creadoPor: viaje.creadoPor,
    creadoEn: viaje.creadoEn.toISOString(),
    miembros: miembros
      .filter((m) => m.viajeId === viaje.id)
      .map((m) => ({ id: m.id, nombre: m.nombre })),
    gastos: gastos
      .filter((g) => g.viajeId === viaje.id)
      .map((g) => ({
        id: g.id,
        creadoPor: g.creadoPor,
        descripcion: g.descripcion,
        categoria: g.categoria,
        moneda: g.moneda,
        montoTotal: g.montoTotal,
        modo: g.modo,
        ocurrioEn: g.ocurrioEn.toISOString(),
        partes: partes
          .filter((p) => p.viajeId === viaje.id && p.gastoId === g.id)
          .map((p) => ({
            usuarioId: p.usuarioId,
            pagado: p.pagado,
            debe: p.debe,
            participa: p.participa,
            peso: p.peso,
          })),
      })),
    pagos: pagos
      .filter((p) => p.viajeId === viaje.id)
      .map((p) => ({
        id: p.id,
        de: p.de,
        a: p.a,
        monto: p.monto,
        registradoPor: p.registradoPor,
        ocurrioEn: p.ocurrioEn.toISOString(),
      })),
  }));
}

function leerTasas(crudo: string): Record<string, number> {
  try {
    const tasas = JSON.parse(crudo);
    return tasas && typeof tasas === 'object' ? tasas : {};
  } catch {
    return {};
  }
}

/* ── El viaje ────────────────────────────────────────────────────── */

export async function crearViaje(
  usuarioId: string,
  datos: z.infer<typeof crearViajeSchema>,
): Promise<ViajeCompleto> {
  const db = await base();
  const id = nuevoId();

  await db.transaction(async (tx) => {
    await tx.insert(esquema.viajes).values({
      id,
      nombre: datos.nombre,
      monedaBase: datos.monedaBase,
      tasas: JSON.stringify(sinBase(datos.tasas, datos.monedaBase)),
      codigo: randomBytes(9).toString('base64url'),
      creadoPor: usuarioId,
    });
    await tx.insert(esquema.viajeMiembros).values({ viajeId: id, usuarioId });
  });

  return leerViaje(usuarioId, id);
}

/** Quien tenga el enlace entra. Entrar dos veces no hace nada. */
export async function unirseAViaje(usuarioId: string, codigo: string): Promise<ViajeCompleto> {
  const db = await base();
  const [viaje] = await db
    .select({ id: esquema.viajes.id })
    .from(esquema.viajes)
    .where(eq(esquema.viajes.codigo, codigo))
    .limit(1);

  if (!viaje) throw new ViajeError(404, 'Ese enlace de invitación no es válido.');

  const miembros = await db
    .select({ usuarioId: esquema.viajeMiembros.usuarioId })
    .from(esquema.viajeMiembros)
    .where(eq(esquema.viajeMiembros.viajeId, viaje.id));

  if (!miembros.some((m) => m.usuarioId === usuarioId)) {
    if (miembros.length >= MAX_MIEMBROS) {
      throw new ViajeError(400, `Un viaje admite hasta ${MAX_MIEMBROS} personas.`);
    }
    await db
      .insert(esquema.viajeMiembros)
      .values({ viajeId: viaje.id, usuarioId })
      .onConflictDoNothing();
  }

  return leerViaje(usuarioId, viaje.id);
}

/** El nombre y las tasas los cambia solo quien creó el viaje. */
export async function editarViaje(
  usuarioId: string,
  viajeId: string,
  datos: z.infer<typeof editarViajeSchema>,
): Promise<ViajeCompleto> {
  const viaje = await exigirMiembro(usuarioId, viajeId);
  if (viaje.creadoPor !== usuarioId) {
    throw new ViajeError(403, 'Solo quien creó el viaje puede cambiarlo.');
  }

  const db = await base();
  const cambios: { nombre?: string; tasas?: string } = {};
  if (datos.nombre) cambios.nombre = datos.nombre;

  if (datos.tasas) {
    const tasas = sinBase(datos.tasas, viaje.monedaBase);
    // Quitar una tasa que ya usan gastos dejaria saldos imposibles de sumar.
    const usadas = await db
      .selectDistinct({ moneda: esquema.viajeGastos.moneda })
      .from(esquema.viajeGastos)
      .where(eq(esquema.viajeGastos.viajeId, viajeId));
    const huerfana = usadas.find((u) => u.moneda !== viaje.monedaBase && !(u.moneda in tasas));
    if (huerfana) {
      throw new ViajeError(400, `Hay gastos en ${huerfana.moneda}: esa tasa no se puede quitar.`);
    }
    cambios.tasas = JSON.stringify(tasas);
  }

  if (Object.keys(cambios).length > 0) {
    await db.update(esquema.viajes).set(cambios).where(eq(esquema.viajes.id, viajeId));
  }

  return leerViaje(usuarioId, viajeId);
}

/* ── Gastos ──────────────────────────────────────────────────────── */

export async function guardarGastoViaje(
  usuarioId: string,
  viajeId: string,
  datos: z.infer<typeof gastoViajeSchema>,
): Promise<ViajeCompleto> {
  const viaje = await exigirMiembro(usuarioId, viajeId);
  const db = await base();

  const miembros = new Set(
    (
      await db
        .select({ usuarioId: esquema.viajeMiembros.usuarioId })
        .from(esquema.viajeMiembros)
        .where(eq(esquema.viajeMiembros.viajeId, viajeId))
    ).map((m) => m.usuarioId),
  );
  const ajeno = [...datos.pagadores, ...datos.participantes].find((p) => !miembros.has(p.usuarioId));
  if (ajeno) throw new ViajeError(400, 'Alguien del gasto no es parte del viaje.');

  const tasas = leerTasas(viaje.tasas);
  if (datos.moneda !== viaje.monedaBase && !(datos.moneda in tasas)) {
    throw new ViajeError(400, `Falta la tasa de ${datos.moneda} para este viaje.`);
  }

  // El porcentaje se guarda en centesimas, y se reparte con eso mismo para
  // que al volver a abrir el gasto los montos salgan identicos.
  const participantes = datos.participantes.map((p) => ({
    ...p,
    peso:
      datos.modo === 'percent'
        ? Math.round((p.porcentaje ?? 0) * 100)
        : datos.modo === 'amounts'
          ? (p.monto ?? 0)
          : null,
  }));

  let partes;
  try {
    partes = resolveTripExpense({
      totalCents: datos.montoTotal,
      payers: datos.pagadores.map((p) => ({ memberId: p.usuarioId, amountCents: p.monto })),
      mode: datos.modo,
      participants: participantes.map((p) => ({
        memberId: p.usuarioId,
        amountCents: p.monto,
        percent: p.peso === null ? undefined : p.peso / 100,
      })),
    });
  } catch (error) {
    if (error instanceof TripError) throw new ViajeError(400, error.message);
    throw error;
  }

  let id = datos.id;
  if (id) {
    const [existente] = await db
      .select({ creadoPor: esquema.viajeGastos.creadoPor })
      .from(esquema.viajeGastos)
      .where(and(eq(esquema.viajeGastos.viajeId, viajeId), eq(esquema.viajeGastos.id, id)))
      .limit(1);
    if (!existente) throw new ViajeError(404, 'Ese gasto ya no existe.');
    if (existente.creadoPor !== usuarioId) {
      throw new ViajeError(403, 'Solo quien registró el gasto puede cambiarlo.');
    }
  } else {
    id = nuevoId();
  }
  const gastoId = id;

  const pesoDe = new Map(participantes.map((p) => [p.usuarioId, p.peso]));
  const valores = {
    descripcion: datos.descripcion,
    categoria: datos.categoria,
    moneda: datos.moneda,
    montoTotal: datos.montoTotal,
    modo: datos.modo,
    ocurrioEn: new Date(`${datos.ocurrioEn}T12:00:00${OFFSET}`),
    actualizadoEn: new Date(),
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(esquema.viajeGastos)
      .values({ id: gastoId, viajeId, creadoPor: usuarioId, ...valores })
      .onConflictDoUpdate({
        target: [esquema.viajeGastos.viajeId, esquema.viajeGastos.id],
        set: valores,
      });

    await tx
      .delete(esquema.viajePartes)
      .where(and(eq(esquema.viajePartes.viajeId, viajeId), eq(esquema.viajePartes.gastoId, gastoId)));

    await tx.insert(esquema.viajePartes).values(
      partes.map((parte) => ({
        viajeId,
        gastoId,
        usuarioId: parte.memberId,
        pagado: parte.paidCents,
        debe: parte.owedCents,
        participa: pesoDe.has(parte.memberId),
        peso: pesoDe.get(parte.memberId) ?? null,
      })),
    );
  });

  return leerViaje(usuarioId, viajeId);
}

export async function borrarGastoViaje(
  usuarioId: string,
  viajeId: string,
  gastoId: string,
): Promise<ViajeCompleto> {
  await exigirMiembro(usuarioId, viajeId);
  const db = await base();

  const [gasto] = await db
    .select({ creadoPor: esquema.viajeGastos.creadoPor })
    .from(esquema.viajeGastos)
    .where(and(eq(esquema.viajeGastos.viajeId, viajeId), eq(esquema.viajeGastos.id, gastoId)))
    .limit(1);

  if (!gasto) throw new ViajeError(404, 'Ese gasto ya no existe.');
  if (gasto.creadoPor !== usuarioId) {
    throw new ViajeError(403, 'Solo quien registró el gasto puede borrarlo.');
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(esquema.viajePartes)
      .where(and(eq(esquema.viajePartes.viajeId, viajeId), eq(esquema.viajePartes.gastoId, gastoId)));
    await tx
      .delete(esquema.viajeGastos)
      .where(and(eq(esquema.viajeGastos.viajeId, viajeId), eq(esquema.viajeGastos.id, gastoId)));
  });

  return leerViaje(usuarioId, viajeId);
}

/* ── Pagos para saldar ───────────────────────────────────────────── */

/** Lo registra quien paga o quien recibe: nadie anota plata que no le pasó por las manos. */
export async function registrarPagoViaje(
  usuarioId: string,
  viajeId: string,
  datos: z.infer<typeof pagoViajeSchema>,
): Promise<ViajeCompleto> {
  await exigirMiembro(usuarioId, viajeId);
  if (datos.de === datos.a) throw new ViajeError(400, 'Un pago va de una persona a otra.');
  if (usuarioId !== datos.de && usuarioId !== datos.a) {
    throw new ViajeError(403, 'Solo quien paga o quien recibe puede registrar el pago.');
  }

  const db = await base();
  const miembros = await db
    .select({ usuarioId: esquema.viajeMiembros.usuarioId })
    .from(esquema.viajeMiembros)
    .where(
      and(
        eq(esquema.viajeMiembros.viajeId, viajeId),
        inArray(esquema.viajeMiembros.usuarioId, [datos.de, datos.a]),
      ),
    );
  if (miembros.length !== 2) throw new ViajeError(400, 'Las dos personas tienen que ser del viaje.');

  // Nadie paga de más: si el pago supera lo pendiente, alguien quedaría
  // debiendo al revés y el viaje terminaría con una deuda que nadie tuvo.
  const viaje = await leerViaje(usuarioId, viajeId);
  const maximo = maxSettlementCents(saldosDeViaje(viaje), datos.de, datos.a);
  if (datos.monto > maximo) {
    const nombre = (id: string) => viaje.miembros.find((m) => m.id === id)?.nombre ?? 'Esa persona';
    throw new ViajeError(
      400,
      maximo === 0
        ? `${nombre(datos.de)} no tiene nada pendiente que pagarle a ${nombre(datos.a)}.`
        : `Es más de lo pendiente: lo máximo que ${nombre(datos.de)} le puede pagar a ${nombre(datos.a)} es ${formatMoney(maximo, { currency: viaje.monedaBase })}.`,
    );
  }

  await db.insert(esquema.viajePagos).values({
    id: nuevoId(),
    viajeId,
    de: datos.de,
    a: datos.a,
    monto: datos.monto,
    registradoPor: usuarioId,
    ocurrioEn: datos.ocurrioEn ? new Date(`${datos.ocurrioEn}T12:00:00${OFFSET}`) : new Date(),
  });

  return leerViaje(usuarioId, viajeId);
}

export async function borrarPagoViaje(
  usuarioId: string,
  viajeId: string,
  pagoId: string,
): Promise<ViajeCompleto> {
  await exigirMiembro(usuarioId, viajeId);
  const db = await base();

  const [pago] = await db
    .select({ registradoPor: esquema.viajePagos.registradoPor })
    .from(esquema.viajePagos)
    .where(and(eq(esquema.viajePagos.viajeId, viajeId), eq(esquema.viajePagos.id, pagoId)))
    .limit(1);

  if (!pago) throw new ViajeError(404, 'Ese pago ya no existe.');
  if (pago.registradoPor !== usuarioId) {
    throw new ViajeError(403, 'Solo quien registró el pago puede borrarlo.');
  }

  await db
    .delete(esquema.viajePagos)
    .where(and(eq(esquema.viajePagos.viajeId, viajeId), eq(esquema.viajePagos.id, pagoId)));

  return leerViaje(usuarioId, viajeId);
}

/** El saldo de cada miembro en la moneda base, con el mismo motor que usa el navegador. */
export function saldosDeViaje(viaje: ViajeCompleto) {
  return computeTripBalances({
    memberIds: viaje.miembros.map((m) => m.id),
    baseCurrency: viaje.monedaBase,
    rates: viaje.tasas,
    expenses: viaje.gastos.map((g) => ({
      currency: g.moneda,
      totalCents: g.montoTotal,
      parts: g.partes.map((p) => ({ memberId: p.usuarioId, paidCents: p.pagado, owedCents: p.debe })),
    })),
    settlements: viaje.pagos.map((p) => ({ fromId: p.de, toId: p.a, amountCents: p.monto })),
  });
}

/* ── Utilidades ──────────────────────────────────────────────────── */

/**
 * El viaje, si quien pide es miembro. Si no lo es responde lo mismo que si el
 * viaje no existiera: no hay por que confirmarle a nadie que un id es real.
 */
async function exigirMiembro(usuarioId: string, viajeId: string) {
  const db = await base();
  const [fila] = await db
    .select({ viaje: esquema.viajes })
    .from(esquema.viajes)
    .innerJoin(
      esquema.viajeMiembros,
      and(
        eq(esquema.viajeMiembros.viajeId, esquema.viajes.id),
        eq(esquema.viajeMiembros.usuarioId, usuarioId),
      ),
    )
    .where(eq(esquema.viajes.id, viajeId))
    .limit(1);

  if (!fila) throw new ViajeError(404, 'No encontramos ese viaje.');
  return fila.viaje;
}

function sinBase(tasas: Partial<Record<string, number>>, monedaBase: string): Record<string, number> {
  const limpias: Record<string, number> = {};
  for (const [codigo, tasa] of Object.entries(tasas)) {
    if (codigo !== monedaBase && typeof tasa === 'number') limpias[codigo] = tasa;
  }
  return limpias;
}
