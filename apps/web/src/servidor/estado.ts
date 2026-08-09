import { base, esquema, type Base } from '@gastos/db';
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { normalizarCorreo } from './cuentas.js';

/**
 * El puente entre las dos formas de ver los mismos datos.
 *
 * El navegador trabaja con un objeto plano en memoria, con nombres en ingles
 * porque son los que entiende el motor de `@gastos/core`. La base los guarda
 * normalizados, en tablas y en castellano. Aqui se traduce en los dos sentidos
 * y en un solo sitio: si manana cambia una columna, cambia aqui y nada mas.
 */

/* ══ La forma que espera el navegador ═══════════════════════════════ */

export type Estado = {
  version: 1;
  cuentas: Cuenta[];
  categorias: Categoria[];
  personas: Persona[];
  gastos: Gasto[];
  repartos: Reparto[];
  abonos: Abono[];
  asignaciones: Asignacion[];
  deudas: Deuda[];
  presupuestos: Record<string, { totalCents: number; limites: Record<string, number> }>;
  fijos: Fijo[];
  instancias: Instancia[];
};

/* ══ Validacion de lo que llega ═════════════════════════════════════ */

const texto = z.string().max(500);
const identificador = z.string().min(1).max(80);
const centavos = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const mesClave = z.string().regex(/^\d{4}-\d{2}$/);

/** Acepta cualquier fecha que Date sepa leer y la deja siempre como Date. */
const fecha = z
  .string()
  .max(60)
  .refine((valor) => !Number.isNaN(Date.parse(valor)), 'fecha invalida')
  .transform((valor) => new Date(valor));

const opcional = <T extends z.ZodTypeAny>(tipo: T) => tipo.nullish().transform((v) => v ?? null);

const cuentaSchema = z.object({
  id: identificador,
  name: texto,
  kind: texto,
});
type Cuenta = z.input<typeof cuentaSchema>;

const categoriaSchema = z.object({
  id: identificador,
  name: texto,
  color: z.string().max(40),
  isArchived: z.boolean().default(false),
});
type Categoria = z.input<typeof categoriaSchema>;

const correoPersona = z
  .string()
  .max(200)
  .nullish()
  .transform((v) => {
    if (!v?.trim()) return null;
    const limpio = normalizarCorreo(v);
    if (!z.string().email().safeParse(limpio).success) {
      throw new z.ZodError([
        { code: 'custom', message: 'correo invalido', path: ['email'] },
      ]);
    }
    return limpio;
  });

const personaSchema = z.object({
  id: identificador,
  name: texto,
  email: correoPersona,
});
type Persona = z.input<typeof personaSchema>;

const gastoSchema = z.object({
  id: identificador,
  accountId: opcional(identificador),
  categoryId: opcional(identificador),
  status: texto.default('confirmed'),
  source: texto.default('manual'),
  amountTotalCents: centavos,
  myShareCents: centavos,
  currency: z.string().max(8).default('COP'),
  merchantRaw: opcional(texto),
  merchantNormalized: opcional(texto),
  description: opcional(texto),
  occurredAt: fecha,
  confirmedAt: opcional(fecha),
  recurringExpenseId: opcional(identificador),
  createdAt: opcional(fecha),
  updatedAt: opcional(fecha),
  deletedAt: opcional(fecha),
});
type Gasto = Omit<z.input<typeof gastoSchema>, 'occurredAt'> & { occurredAt: string };

const repartoSchema = z.object({
  id: identificador,
  expenseId: identificador,
  personId: identificador,
  amountCents: centavos,
  notifiedAt: fecha.nullish(),
});
type Reparto = z.input<typeof repartoSchema>;

const abonoSchema = z.object({
  id: identificador,
  personId: identificador,
  amountCents: centavos,
  paidAt: fecha,
});
type Abono = Omit<z.input<typeof abonoSchema>, 'paidAt'> & { paidAt: string };

const asignacionSchema = z.object({
  id: identificador,
  settlementId: identificador,
  splitId: identificador,
  amountCents: centavos,
});
type Asignacion = z.input<typeof asignacionSchema>;

const deudaSchema = z.object({
  id: identificador,
  personId: identificador,
  amountCents: centavos,
  description: opcional(texto),
  occurredAt: fecha,
  settledAt: opcional(fecha),
});
type Deuda = Omit<z.input<typeof deudaSchema>, 'occurredAt'> & { occurredAt: string };

const fijoSchema = z.object({
  id: identificador,
  name: texto,
  categoryId: opcional(identificador),
  amountCents: centavos,
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  isVariable: z.boolean().default(false),
  isArchived: z.boolean().default(false),
});
type Fijo = z.input<typeof fijoSchema>;

const instanciaSchema = z.object({
  id: identificador,
  recurringId: identificador,
  month: mesClave,
  plannedCents: centavos,
  status: texto.default('planned'),
  expenseId: opcional(identificador),
});
type Instancia = z.input<typeof instanciaSchema>;

const presupuestoSchema = z.object({
  mes: mesClave,
  totalCents: centavos,
  limites: z.record(identificador, centavos).default({}),
});

/** Cada coleccion viaja como lo que se puso o cambio, y lo que se quito. */
const delta = <T extends z.ZodTypeAny>(fila: T) =>
  z
    .object({
      puestos: z.array(fila).max(20_000).default([]),
      quitados: z.array(z.string().max(80)).max(20_000).default([]),
    })
    .default({ puestos: [], quitados: [] });

export const cambiosSchema = z.object({
  cuentas: delta(cuentaSchema.extend({ posicion: z.number().int().default(0) })),
  categorias: delta(categoriaSchema.extend({ posicion: z.number().int().default(0) })),
  personas: delta(personaSchema.extend({ posicion: z.number().int().default(0) })),
  gastos: delta(gastoSchema),
  repartos: delta(repartoSchema),
  abonos: delta(abonoSchema),
  asignaciones: delta(asignacionSchema),
  deudas: delta(deudaSchema),
  fijos: delta(fijoSchema.extend({ posicion: z.number().int().default(0) })),
  instancias: delta(instanciaSchema),
  presupuestos: delta(presupuestoSchema),
});

export type Cambios = z.infer<typeof cambiosSchema>;

/** La copia que exporta el navegador (`Descargar copia`). */
export const estadoExportadoSchema = z.object({
  version: z.literal(1),
  cuentas: z.array(cuentaSchema),
  categorias: z.array(categoriaSchema),
  personas: z.array(personaSchema),
  gastos: z.array(gastoSchema),
  repartos: z.array(repartoSchema),
  abonos: z.array(abonoSchema).default([]),
  asignaciones: z.array(asignacionSchema).default([]),
  deudas: z.array(deudaSchema).default([]),
  fijos: z.array(fijoSchema).default([]),
  instancias: z.array(instanciaSchema).default([]),
  presupuestos: z
    .record(
      mesClave,
      z.object({
        totalCents: centavos,
        limites: z.record(identificador, centavos).default({}),
      }),
    )
    .default({}),
});

export type EstadoExportado = z.infer<typeof estadoExportadoSchema>;

/** Convierte una copia entera en el delta que entiende `aplicarCambios`. */
export function estadoACambios(datos: EstadoExportado): Cambios {
  return cambiosSchema.parse({
    cuentas: {
      puestos: datos.cuentas.map((c, i) => ({ ...c, posicion: i })),
      quitados: [],
    },
    categorias: {
      puestos: datos.categorias.map((c, i) => ({ ...c, posicion: i })),
      quitados: [],
    },
    personas: {
      puestos: datos.personas.map((p, i) => ({ ...p, posicion: i })),
      quitados: [],
    },
    gastos: { puestos: datos.gastos, quitados: [] },
    repartos: { puestos: datos.repartos, quitados: [] },
    abonos: { puestos: datos.abonos, quitados: [] },
    asignaciones: { puestos: datos.asignaciones, quitados: [] },
    deudas: { puestos: datos.deudas, quitados: [] },
    fijos: {
      puestos: datos.fijos.map((f, i) => ({ ...f, posicion: i })),
      quitados: [],
    },
    instancias: { puestos: datos.instancias, quitados: [] },
    presupuestos: {
      puestos: Object.entries(datos.presupuestos).map(([mes, v]) => ({
        mes,
        totalCents: v.totalCents,
        limites: v.limites,
      })),
      quitados: [],
    },
  });
}

/** Sube de una vez la copia exportada, pisando lo que haya en la cuenta. */
export async function subirEstadoCompleto(
  usuarioId: string,
  revisionCliente: number,
  datos: EstadoExportado,
): Promise<number> {
  return aplicarCambios(usuarioId, revisionCliente, estadoACambios(datos));
}

/* ══ Leer ═══════════════════════════════════════════════════════════ */

const iso = (valor: Date | null) => (valor ? valor.toISOString() : null);

export async function leerEstado(usuarioId: string): Promise<Estado> {
  const db = await base();
  const mio = <T extends PgTable & { usuarioId: PgColumn }>(tabla: T) =>
    eq(tabla.usuarioId, usuarioId);

  const [
    cuentas,
    categorias,
    personas,
    gastos,
    repartos,
    abonos,
    asignaciones,
    deudas,
    presupuestos,
    topes,
    fijos,
    instancias,
  ] = await Promise.all([
    db.select().from(esquema.cuentas).where(mio(esquema.cuentas)).orderBy(asc(esquema.cuentas.posicion)),
    db
      .select()
      .from(esquema.categorias)
      .where(mio(esquema.categorias))
      .orderBy(asc(esquema.categorias.posicion)),
    db
      .select()
      .from(esquema.personas)
      .where(mio(esquema.personas))
      .orderBy(asc(esquema.personas.posicion)),
    db.select().from(esquema.gastos).where(mio(esquema.gastos)).orderBy(asc(esquema.gastos.ocurrioEn)),
    db.select().from(esquema.repartos).where(mio(esquema.repartos)),
    db.select().from(esquema.abonos).where(mio(esquema.abonos)),
    db.select().from(esquema.asignaciones).where(mio(esquema.asignaciones)),
    db.select().from(esquema.deudas).where(mio(esquema.deudas)),
    db.select().from(esquema.presupuestos).where(mio(esquema.presupuestos)),
    db.select().from(esquema.topes).where(mio(esquema.topes)),
    db.select().from(esquema.fijos).where(mio(esquema.fijos)).orderBy(asc(esquema.fijos.posicion)),
    db.select().from(esquema.instancias).where(mio(esquema.instancias)),
  ]);

  const porMes: Estado['presupuestos'] = {};
  for (const fila of presupuestos) porMes[fila.mes] = { totalCents: fila.total, limites: {} };
  for (const tope of topes) {
    const presupuesto = (porMes[tope.mes] ??= { totalCents: 0, limites: {} });
    presupuesto.limites[tope.categoriaId] = tope.monto;
  }

  return {
    version: 1,
    cuentas: cuentas.map((c) => ({ id: c.id, name: c.nombre, kind: c.tipo })),
    categorias: categorias.map((c) => ({
      id: c.id,
      name: c.nombre,
      color: c.color,
      isArchived: c.archivada,
    })),
    personas: personas.map((p) => ({ id: p.id, name: p.nombre, email: p.correo })),
    gastos: gastos.map((g) => ({
      id: g.id,
      accountId: g.cuentaId,
      categoryId: g.categoriaId,
      status: g.estado,
      source: g.origen,
      amountTotalCents: g.montoTotal,
      myShareCents: g.miParte,
      currency: g.moneda,
      merchantRaw: g.comercio,
      merchantNormalized: g.comercioNormalizado,
      description: g.descripcion,
      occurredAt: g.ocurrioEn.toISOString(),
      confirmedAt: iso(g.confirmadoEn),
      recurringExpenseId: g.fijoId,
      createdAt: iso(g.creadoEn),
      updatedAt: iso(g.actualizadoEn),
      deletedAt: iso(g.borradoEn),
    })),
    repartos: repartos.map((r) => ({
      id: r.id,
      expenseId: r.gastoId,
      personId: r.personaId,
      amountCents: r.monto,
      notifiedAt: iso(r.avisadoEn),
    })),
    abonos: abonos.map((a) => ({
      id: a.id,
      personId: a.personaId,
      amountCents: a.monto,
      paidAt: a.pagadoEn.toISOString(),
    })),
    asignaciones: asignaciones.map((a) => ({
      id: a.id,
      settlementId: a.abonoId,
      splitId: a.repartoId,
      amountCents: a.monto,
    })),
    deudas: deudas.map((d) => ({
      id: d.id,
      personId: d.personaId,
      amountCents: d.monto,
      description: d.descripcion,
      occurredAt: d.ocurrioEn.toISOString(),
      settledAt: iso(d.pagadaEn),
    })),
    presupuestos: porMes,
    fijos: fijos.map((f) => ({
      id: f.id,
      name: f.nombre,
      categoryId: f.categoriaId,
      amountCents: f.monto,
      dayOfMonth: f.diaDelMes,
      isVariable: f.variable,
      isArchived: f.archivado,
    })),
    instancias: instancias.map((i) => ({
      id: i.id,
      recurringId: i.fijoId,
      month: i.mes,
      plannedCents: i.montoPlaneado,
      status: i.estado,
      expenseId: i.gastoId,
    })),
  };
}

/* ══ Escribir ═══════════════════════════════════════════════════════ */

export class RevisionVieja extends Error {
  constructor() {
    super('Otro dispositivo guardo primero');
  }
}

type Tx = Parameters<Parameters<Base['transaction']>[0]>[0];

/**
 * Postgres admite 65.535 parametros por sentencia. Con dieciocho columnas por
 * gasto, doscientas filas por tanda dejan margen de sobra y siguen siendo
 * pocos viajes.
 */
const TANDA = 200;

const enTandas = <T>(lista: T[]): T[][] => {
  const tandas: T[][] = [];
  for (let i = 0; i < lista.length; i += TANDA) tandas.push(lista.slice(i, i + TANDA));
  return tandas;
};

/**
 * Inserta o pisa, segun exista la fila. Las columnas que no son clave se
 * copian de `excluded`, que es como Postgres llama a la fila que se intentaba
 * insertar.
 */
async function guardarFilas(
  tx: Tx,
  tabla: PgTable,
  clave: string[],
  filas: Record<string, unknown>[],
): Promise<void> {
  if (filas.length === 0) return;

  const columnas = getTableColumns(tabla) as Record<string, PgColumn>;
  const objetivo = clave.map((nombre) => columnas[nombre]!);
  const nuevos = Object.fromEntries(
    Object.keys(columnas)
      .filter((nombre) => !clave.includes(nombre))
      .map((nombre) => [nombre, sql.raw(`excluded."${columnas[nombre]!.name}"`)]),
  );

  for (const tanda of enTandas(filas)) {
    await tx.insert(tabla).values(tanda).onConflictDoUpdate({ target: objetivo, set: nuevos });
  }
}

async function quitarFilas(
  tx: Tx,
  tabla: PgTable & { usuarioId: PgColumn; id: PgColumn },
  usuarioId: string,
  ids: string[],
): Promise<void> {
  for (const tanda of enTandas(ids)) {
    await tx.delete(tabla).where(and(eq(tabla.usuarioId, usuarioId), inArray(tabla.id, tanda)));
  }
}

export async function aplicarCambios(
  usuarioId: string,
  revisionCliente: number,
  cambios: Cambios,
): Promise<number> {
  const db = await base();

  return db.transaction(async (tx) => {
    // Subir la revision de entrada hace dos cosas a la vez: detecta que otro
    // dispositivo escribio primero y bloquea la fila del usuario, de modo que
    // dos guardados simultaneos se serializan en vez de mezclarse.
    const [avance] = await tx
      .update(esquema.usuarios)
      .set({ revision: sql`${esquema.usuarios.revision} + 1` })
      .where(
        and(eq(esquema.usuarios.id, usuarioId), eq(esquema.usuarios.revision, revisionCliente)),
      )
      .returning({ revision: esquema.usuarios.revision });

    if (!avance) throw new RevisionVieja();

    // Primero lo que se quita y luego lo que se pone: si en un mismo envio
    // desaparece un gasto y nace otro reciclando el id, el orden importa.
    await quitarFilas(tx, esquema.instancias, usuarioId, cambios.instancias.quitados);
    await quitarFilas(tx, esquema.asignaciones, usuarioId, cambios.asignaciones.quitados);
    await quitarFilas(tx, esquema.abonos, usuarioId, cambios.abonos.quitados);
    await quitarFilas(tx, esquema.repartos, usuarioId, cambios.repartos.quitados);
    await quitarFilas(tx, esquema.deudas, usuarioId, cambios.deudas.quitados);
    await quitarFilas(tx, esquema.gastos, usuarioId, cambios.gastos.quitados);
    await quitarFilas(tx, esquema.fijos, usuarioId, cambios.fijos.quitados);
    await quitarFilas(tx, esquema.personas, usuarioId, cambios.personas.quitados);
    await quitarFilas(tx, esquema.categorias, usuarioId, cambios.categorias.quitados);
    await quitarFilas(tx, esquema.cuentas, usuarioId, cambios.cuentas.quitados);

    for (const tanda of enTandas(cambios.presupuestos.quitados)) {
      await tx
        .delete(esquema.presupuestos)
        .where(and(eq(esquema.presupuestos.usuarioId, usuarioId), inArray(esquema.presupuestos.mes, tanda)));
      await tx
        .delete(esquema.topes)
        .where(and(eq(esquema.topes.usuarioId, usuarioId), inArray(esquema.topes.mes, tanda)));
    }

    const clave = ['usuarioId', 'id'];

    await guardarFilas(
      tx,
      esquema.cuentas,
      clave,
      cambios.cuentas.puestos.map((c) => ({
        id: c.id,
        usuarioId,
        nombre: c.name,
        tipo: c.kind,
        posicion: c.posicion,
      })),
    );

    await guardarFilas(
      tx,
      esquema.categorias,
      clave,
      cambios.categorias.puestos.map((c) => ({
        id: c.id,
        usuarioId,
        nombre: c.name,
        color: c.color,
        archivada: c.isArchived,
        posicion: c.posicion,
      })),
    );

    await guardarFilas(
      tx,
      esquema.personas,
      clave,
      cambios.personas.puestos.map((p) => ({
        id: p.id,
        usuarioId,
        nombre: p.name,
        correo: p.email,
        posicion: p.posicion,
      })),
    );

    await guardarFilas(
      tx,
      esquema.gastos,
      clave,
      cambios.gastos.puestos.map((g) => ({
        id: g.id,
        usuarioId,
        cuentaId: g.accountId,
        categoriaId: g.categoryId,
        estado: g.status,
        origen: g.source,
        montoTotal: g.amountTotalCents,
        miParte: g.myShareCents,
        moneda: g.currency,
        comercio: g.merchantRaw,
        comercioNormalizado: g.merchantNormalized,
        descripcion: g.description,
        ocurrioEn: g.occurredAt,
        confirmadoEn: g.confirmedAt,
        fijoId: g.recurringExpenseId,
        creadoEn: g.createdAt ?? new Date(),
        actualizadoEn: g.updatedAt ?? new Date(),
        borradoEn: g.deletedAt,
      })),
    );

    await guardarFilas(
      tx,
      esquema.repartos,
      clave,
      cambios.repartos.puestos.map((r) => ({
        id: r.id,
        usuarioId,
        gastoId: r.expenseId,
        personaId: r.personId,
        monto: r.amountCents,
        avisadoEn: r.notifiedAt,
      })),
    );

    await guardarFilas(
      tx,
      esquema.abonos,
      clave,
      cambios.abonos.puestos.map((a) => ({
        id: a.id,
        usuarioId,
        personaId: a.personId,
        monto: a.amountCents,
        pagadoEn: a.paidAt,
      })),
    );

    await guardarFilas(
      tx,
      esquema.asignaciones,
      clave,
      cambios.asignaciones.puestos.map((a) => ({
        id: a.id,
        usuarioId,
        abonoId: a.settlementId,
        repartoId: a.splitId,
        monto: a.amountCents,
      })),
    );

    await guardarFilas(
      tx,
      esquema.deudas,
      clave,
      cambios.deudas.puestos.map((d) => ({
        id: d.id,
        usuarioId,
        personaId: d.personId,
        monto: d.amountCents,
        descripcion: d.description,
        ocurrioEn: d.occurredAt,
        pagadaEn: d.settledAt,
      })),
    );

    await guardarFilas(
      tx,
      esquema.fijos,
      clave,
      cambios.fijos.puestos.map((f) => ({
        id: f.id,
        usuarioId,
        nombre: f.name,
        categoriaId: f.categoryId,
        monto: f.amountCents,
        diaDelMes: f.dayOfMonth,
        variable: f.isVariable,
        archivado: f.isArchived,
        posicion: f.posicion,
      })),
    );

    await guardarFilas(
      tx,
      esquema.instancias,
      clave,
      cambios.instancias.puestos.map((i) => ({
        id: i.id,
        usuarioId,
        fijoId: i.recurringId,
        mes: i.month,
        montoPlaneado: i.plannedCents,
        estado: i.status,
        gastoId: i.expenseId,
      })),
    );

    await guardarFilas(
      tx,
      esquema.presupuestos,
      ['usuarioId', 'mes'],
      cambios.presupuestos.puestos.map((p) => ({
        usuarioId,
        mes: p.mes,
        total: p.totalCents,
      })),
    );

    // Los topes de un mes se reemplazan enteros: quitar un tope es borrar su
    // clave del objeto, y desde el delta no hay forma de distinguir "lo quite"
    // de "no lo mande".
    for (const presupuesto of cambios.presupuestos.puestos) {
      await tx
        .delete(esquema.topes)
        .where(
          and(eq(esquema.topes.usuarioId, usuarioId), eq(esquema.topes.mes, presupuesto.mes)),
        );

      const filas = Object.entries(presupuesto.limites)
        .filter(([, monto]) => monto > 0)
        .map(([categoriaId, monto]) => ({ usuarioId, mes: presupuesto.mes, categoriaId, monto }));

      await guardarFilas(tx, esquema.topes, ['usuarioId', 'mes', 'categoriaId'], filas);
    }

    return avance.revision;
  });
}
