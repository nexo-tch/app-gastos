import { z } from 'zod';
import { estadoExportadoSchema, leerEstado, subirEstadoCompleto } from '@/servidor/estado';
import { problema, respuestaJson } from '@/servidor/respuesta';
import { exigirUsuario } from '@/servidor/sesion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticion = z.object({
  revision: z.number().int().min(0),
  datos: estadoExportadoSchema,
});

/**
 * Sube de una vez la copia que sale de "Descargar copia".
 *
 * Sirve cuando el telefono lleva dias guardando en localStorage y los deltas
 * nunca llegaron al servidor: en un solo viaje queda todo en Postgres.
 */
export async function POST(request: Request) {
  try {
    const usuario = await exigirUsuario();
    const cuerpo = peticion.safeParse(await request.json().catch(() => null));

    if (!cuerpo.success) {
      console.error('POST /api/estado/completo rechazado', cuerpo.error.flatten());
      return respuestaJson({ error: 'La copia no tiene el formato esperado.' }, { status: 400 });
    }

    const revision = await subirEstadoCompleto(
      usuario.id,
      cuerpo.data.revision,
      cuerpo.data.datos,
    );

    return respuestaJson({
      revision,
      datos: await leerEstado(usuario.id),
    });
  } catch (error) {
    return problema(error);
  }
}
