import { base, esquema } from '@gastos/db';
import { and, eq, gt, lt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

export const GALLETA = 'gastos_sesion';

const DURACION_DIAS = 30;

/**
 * En la base solo vive el hash del token, nunca el token. Si alguien se lleva
 * la tabla `sesiones` no se lleva llaves con las que entrar, igual que pasa
 * con las contrasenas.
 */
const huellaDe = (token: string) => createHash('sha256').update(token).digest('hex');

export type Usuario = {
  id: string;
  correo: string;
  nombre: string;
  revision: number;
};

/* ── La sesion en la base, sin saber de HTTP ─────────────────────── */

export async function nuevaSesion(usuarioId: string): Promise<{ token: string; expira: Date }> {
  const db = await base();
  const token = randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + DURACION_DIAS * 24 * 60 * 60 * 1000);

  await db.insert(esquema.sesiones).values({ huella: huellaDe(token), usuarioId, expiraEn: expira });

  // Las caducadas no estorban a nadie, pero tampoco hay razon para acumularlas.
  await db.delete(esquema.sesiones).where(lt(esquema.sesiones.expiraEn, new Date()));

  return { token, expira };
}

export async function usuarioDeToken(token: string): Promise<Usuario | null> {
  const db = await base();
  const filas = await db
    .select({
      id: esquema.usuarios.id,
      correo: esquema.usuarios.correo,
      nombre: esquema.usuarios.nombre,
      revision: esquema.usuarios.revision,
    })
    .from(esquema.sesiones)
    .innerJoin(esquema.usuarios, eq(esquema.usuarios.id, esquema.sesiones.usuarioId))
    .where(
      and(eq(esquema.sesiones.huella, huellaDe(token)), gt(esquema.sesiones.expiraEn, new Date())),
    )
    .limit(1);

  return filas[0] ?? null;
}

export async function borrarSesion(token: string): Promise<void> {
  const db = await base();
  await db.delete(esquema.sesiones).where(eq(esquema.sesiones.huella, huellaDe(token)));
}

/* ── La misma sesion, vista desde la peticion ────────────────────── */

export async function abrirSesion(usuarioId: string): Promise<void> {
  const { token, expira } = await nuevaSesion(usuarioId);
  const galletas = await cookies();

  galletas.set(GALLETA, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expira,
  });
}

export async function cerrarSesion(): Promise<void> {
  const galletas = await cookies();
  const token = galletas.get(GALLETA)?.value;
  if (token) await borrarSesion(token);
  galletas.delete(GALLETA);
}

/** El usuario de la peticion actual, o null si la sesion no vale o caduco. */
export async function usuarioActual(): Promise<Usuario | null> {
  const galletas = await cookies();
  const token = galletas.get(GALLETA)?.value;
  return token ? usuarioDeToken(token) : null;
}

/** Azucar para los endpoints: o hay usuario, o se corta con 401. */
export class SinPermiso extends Error {
  constructor() {
    super('Necesitas entrar');
  }
}

export async function exigirUsuario(): Promise<Usuario> {
  const usuario = await usuarioActual();
  if (!usuario) throw new SinPermiso();
  return usuario;
}
