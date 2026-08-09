import { base, esquema } from '@gastos/db';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { cifrar, coincide } from './claves.js';
import { filasIniciales } from './siembra.js';

/**
 * Crear cuentas y comprobar contrasenas, sin saber nada de HTTP.
 *
 * Los endpoints de arriba solo traducen esto a codigos de estado. Separarlo
 * permite probar el registro y la entrada de verdad contra una base, sin tener
 * que fabricar peticiones ni galletas.
 */

export type Resultado = { ok: true; usuarioId: string } | { ok: false; error: string };

/** El correo no distingue mayusculas: se guarda y se busca siempre igual. */
export const normalizarCorreo = (correo: string) => correo.trim().toLowerCase();

export async function crearCuenta(datos: {
  correo: string;
  clave: string;
  nombre: string;
}): Promise<Resultado> {
  const correo = normalizarCorreo(datos.correo);
  const db = await base();

  const ocupado = await db
    .select({ id: esquema.usuarios.id })
    .from(esquema.usuarios)
    .where(eq(esquema.usuarios.correo, correo))
    .limit(1);

  if (ocupado.length > 0) return { ok: false, error: 'Ya hay una cuenta con ese correo.' };

  const usuarioId = randomBytes(12).toString('base64url');
  const semilla = filasIniciales(usuarioId);
  const clave = await cifrar(datos.clave);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(esquema.usuarios).values({
        id: usuarioId,
        correo,
        clave,
        nombre: datos.nombre.trim(),
      });
      await tx.insert(esquema.cuentas).values(semilla.cuentas);
      await tx.insert(esquema.categorias).values(semilla.categorias);
    });
  } catch {
    // El indice unico es la ultima palabra: dos registros a la vez con el
    // mismo correo llegan aqui aunque la consulta de arriba diga que no hay.
    return { ok: false, error: 'Ya hay una cuenta con ese correo.' };
  }

  return { ok: true, usuarioId };
}

export async function comprobarClave(correo: string, clave: string): Promise<Resultado> {
  const db = await base();
  const [usuario] = await db
    .select({ id: esquema.usuarios.id, clave: esquema.usuarios.clave })
    .from(esquema.usuarios)
    .where(eq(esquema.usuarios.correo, normalizarCorreo(correo)))
    .limit(1);

  // El mismo mensaje si el correo no existe o si la clave no es: decir cual de
  // las dos falla le regala a cualquiera una lista de correos registrados.
  const valida = usuario ? await coincide(clave, usuario.clave) : false;
  if (!usuario || !valida) return { ok: false, error: 'Ese correo y esa clave no coinciden.' };

  return { ok: true, usuarioId: usuario.id };
}
