import { base, esquema } from '@gastos/db';
import { and, eq, sql } from 'drizzle-orm';
import { normalizarCorreo } from './cuentas.js';

export class CompartidoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
  }
}

/**
 * El receptor aceptó su parte: marcamos el reparto del emisor con la misma
 * clave que viaja en el enlace (`i` = id del reparto en la cuenta de quien compartió).
 */
export async function marcarCompartidoAceptado(
  datos: { repartoId: string; emisorCorreo: string; montoCentavos: number },
): Promise<boolean> {
  const emisorCorreo = normalizarCorreo(datos.emisorCorreo);
  if (!emisorCorreo || !datos.repartoId) return false;

  const db = await base();

  const [emisor] = await db
    .select({ id: esquema.usuarios.id })
    .from(esquema.usuarios)
    .where(eq(esquema.usuarios.correo, emisorCorreo))
    .limit(1);

  // Quien compartió sin cuenta en la app no tiene reparto que actualizar.
  if (!emisor) return false;

  const [reparto] = await db
    .select({ monto: esquema.repartos.monto })
    .from(esquema.repartos)
    .where(and(eq(esquema.repartos.usuarioId, emisor.id), eq(esquema.repartos.id, datos.repartoId)))
    .limit(1);

  if (!reparto) throw new CompartidoInvalido('No encontramos ese gasto compartido.');
  if (reparto.monto !== datos.montoCentavos) {
    throw new CompartidoInvalido('El monto no coincide con lo compartido.');
  }

  const cuando = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(esquema.repartos)
      .set({ aceptadoEn: cuando })
      .where(and(eq(esquema.repartos.usuarioId, emisor.id), eq(esquema.repartos.id, datos.repartoId)));

    await tx
      .update(esquema.usuarios)
      .set({ revision: sql`${esquema.usuarios.revision} + 1` })
      .where(eq(esquema.usuarios.id, emisor.id));
  });

  return true;
}
