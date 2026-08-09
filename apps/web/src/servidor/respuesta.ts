import { NextResponse } from 'next/server';
import { RevisionVieja, leerEstado } from '@/servidor/estado';
import { SinPermiso, exigirUsuario } from '@/servidor/sesion';

/** Las respuestas de la API nunca se cachean: servir datos viejos rompe la sync. */
export function respuestaJson(cuerpo: unknown, init?: ResponseInit) {
  const respuesta = NextResponse.json(cuerpo, init);
  respuesta.headers.set('Cache-Control', 'no-store, private, max-age=0');
  respuesta.headers.set('Pragma', 'no-cache');
  respuesta.headers.set('Vary', 'Cookie');
  return respuesta;
}

export async function problema(error: unknown) {
  if (error instanceof SinPermiso) {
    return respuestaJson({ error: error.message }, { status: 401 });
  }

  if (error instanceof RevisionVieja) {
    const usuario = await exigirUsuario();
    return respuestaJson(
      {
        error: error.message,
        revision: usuario.revision,
        datos: await leerEstado(usuario.id),
      },
      { status: 409 },
    );
  }

  console.error('Fallo en la API de estado', error);
  return respuestaJson({ error: 'No se pudo guardar.' }, { status: 500 });
}
