import { base, esquema } from '@gastos/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { normalizarCorreo } from './cuentas.js';
import { CompartidoInvalido } from './compartido.js';

export interface CargaCompartida {
  v: number;
  i: string;
  de: string;
  dc: string;
  pe: string;
  q: string;
  k: string;
  c: number;
  t: number;
  d: string;
}

export interface NotificacionPendiente {
  id: string;
  tipo: string;
  repartoId: string;
  emisorCorreo: string;
  emisorNombre: string | null;
  carga: CargaCompartida;
  createdAt: string;
}

function nombreDelGasto(gasto: {
  descripcion: string | null;
  comercio: string | null;
  comercioNormalizado: string | null;
}) {
  return gasto.descripcion || gasto.comercio || gasto.comercioNormalizado || 'Un gasto';
}

/**
 * Si la persona del reparto tiene correo de una cuenta en la app, le dejamos
 * el aviso en su bandeja además del enlace de WhatsApp.
 */
export async function entregarCompartidoInApp(
  emisorId: string,
  repartoId: string,
): Promise<{ entregada: boolean }> {
  const db = await base();

  const [emisor] = await db
    .select({ nombre: esquema.usuarios.nombre, correo: esquema.usuarios.correo })
    .from(esquema.usuarios)
    .where(eq(esquema.usuarios.id, emisorId))
    .limit(1);

  const [reparto] = await db
    .select()
    .from(esquema.repartos)
    .where(and(eq(esquema.repartos.usuarioId, emisorId), eq(esquema.repartos.id, repartoId)))
    .limit(1);

  if (!reparto) throw new CompartidoInvalido('No encontramos ese reparto.');

  const [persona] = await db
    .select({ correo: esquema.personas.correo })
    .from(esquema.personas)
    .where(and(eq(esquema.personas.usuarioId, emisorId), eq(esquema.personas.id, reparto.personaId)))
    .limit(1);

  const correoReceptor = persona?.correo ? normalizarCorreo(persona.correo) : '';
  if (!correoReceptor) return { entregada: false };

  const [receptor] = await db
    .select({ id: esquema.usuarios.id })
    .from(esquema.usuarios)
    .where(eq(esquema.usuarios.correo, correoReceptor))
    .limit(1);

  if (!receptor || receptor.id === emisorId) return { entregada: false };

  const [gasto] = await db
    .select()
    .from(esquema.gastos)
    .where(and(eq(esquema.gastos.usuarioId, emisorId), eq(esquema.gastos.id, reparto.gastoId)))
    .limit(1);

  if (!gasto || gasto.borradoEn) throw new CompartidoInvalido('No encontramos ese gasto.');

  let categoriaNombre = '';
  if (gasto.categoriaId) {
    const [categoria] = await db
      .select({ nombre: esquema.categorias.nombre })
      .from(esquema.categorias)
      .where(
        and(eq(esquema.categorias.usuarioId, emisorId), eq(esquema.categorias.id, gasto.categoriaId)),
      )
      .limit(1);
    categoriaNombre = categoria?.nombre ?? '';
  }

  const carga: CargaCompartida = {
    v: 1,
    i: reparto.id,
    de: (emisor?.nombre ?? '').trim().slice(0, 40),
    dc: emisor?.correo ? normalizarCorreo(emisor.correo).slice(0, 80) : '',
    pe: correoReceptor.slice(0, 80),
    q: String(nombreDelGasto(gasto)).slice(0, 60),
    k: categoriaNombre.slice(0, 30),
    c: reparto.monto,
    t: gasto.montoTotal,
    d: gasto.ocurrioEn.toISOString().slice(0, 10),
  };

  const cuando = new Date();

  await db
    .insert(esquema.notificaciones)
    .values({
      id: reparto.id,
      usuarioId: receptor.id,
      tipo: 'gasto_compartido',
      repartoId: reparto.id,
      emisorCorreo: normalizarCorreo(emisor!.correo),
      emisorNombre: emisor?.nombre ?? null,
      carga: JSON.stringify(carga),
      leidaEn: null,
      creadaEn: cuando,
    })
    .onConflictDoUpdate({
      target: [esquema.notificaciones.usuarioId, esquema.notificaciones.id],
      set: {
        carga: JSON.stringify(carga),
        creadaEn: cuando,
        leidaEn: null,
      },
    });

  return { entregada: true };
}

export async function listarNotificacionesPendientes(usuarioId: string): Promise<NotificacionPendiente[]> {
  const db = await base();

  const filas = await db
    .select()
    .from(esquema.notificaciones)
    .where(and(eq(esquema.notificaciones.usuarioId, usuarioId), isNull(esquema.notificaciones.leidaEn)))
    .orderBy(desc(esquema.notificaciones.creadaEn));

  return filas.map((fila) => ({
    id: fila.id,
    tipo: fila.tipo,
    repartoId: fila.repartoId,
    emisorCorreo: fila.emisorCorreo,
    emisorNombre: fila.emisorNombre,
    carga: JSON.parse(fila.carga) as CargaCompartida,
    createdAt: fila.creadaEn.toISOString(),
  }));
}

export async function marcarNotificacionLeida(usuarioId: string, id: string): Promise<boolean> {
  const db = await base();
  const cuando = new Date();

  const actualizadas = await db
    .update(esquema.notificaciones)
    .set({ leidaEn: cuando })
    .where(and(eq(esquema.notificaciones.usuarioId, usuarioId), eq(esquema.notificaciones.id, id)))
    .returning({ id: esquema.notificaciones.id });

  return actualizadas.length > 0;
}
