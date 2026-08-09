import { z } from 'zod';
import {
  aplicarCambios,
  cambiosSchema,
  estadoExportadoSchema,
  leerEstado,
  subirEstadoCompleto,
} from '@/servidor/estado';
import { problema, respuestaJson } from '@/servidor/respuesta';
import { exigirUsuario } from '@/servidor/sesion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticionDelta = z.object({
  revision: z.number().int().min(0),
  cambios: cambiosSchema,
});

const peticionCompleto = z.object({
  revision: z.number().int().min(0),
  datos: estadoExportadoSchema,
});

/** Todo lo del usuario, en la forma exacta que el navegador sabe pintar. */
export async function GET() {
  try {
    const usuario = await exigirUsuario();
    return respuestaJson({
      revision: usuario.revision,
      nombre: usuario.nombre,
      correo: usuario.correo,
      datos: await leerEstado(usuario.id),
    });
  } catch (error) {
    return problema(error);
  }
}

/** Cambios incrementales, o la copia entera si llega `datos` en vez de `cambios`. */
export async function PUT(request: Request) {
  try {
    const usuario = await exigirUsuario();
    const crudo = await request.json().catch(() => null);

    const delta = peticionDelta.safeParse(crudo);
    if (delta.success) {
      const revision = await aplicarCambios(usuario.id, delta.data.revision, delta.data.cambios);
      return respuestaJson({ revision });
    }

    const completo = peticionCompleto.safeParse(crudo);
    if (completo.success) {
      const revision = await subirEstadoCompleto(
        usuario.id,
        completo.data.revision,
        completo.data.datos,
      );
      return respuestaJson({ revision });
    }

    console.error(
      'PUT /api/estado rechazado',
      delta.error?.flatten(),
      completo.error?.flatten(),
    );
    return respuestaJson({ error: 'Cambios mal formados.' }, { status: 400 });
  } catch (error) {
    return problema(error);
  }
}
