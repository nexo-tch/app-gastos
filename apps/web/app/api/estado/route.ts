import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RevisionVieja, aplicarCambios, cambiosSchema, leerEstado } from '@/servidor/estado';
import { SinPermiso, exigirUsuario } from '@/servidor/sesion';

export const runtime = 'nodejs';

/** Todo lo del usuario, en la forma exacta que el navegador sabe pintar. */
export async function GET() {
  try {
    const usuario = await exigirUsuario();
    return NextResponse.json({
      revision: usuario.revision,
      nombre: usuario.nombre,
      correo: usuario.correo,
      datos: await leerEstado(usuario.id),
    });
  } catch (error) {
    return problema(error);
  }
}

const peticion = z.object({
  revision: z.number().int().min(0),
  cambios: cambiosSchema,
});

/** Solo lo que cambio desde el ultimo guardado confirmado. */
export async function PUT(request: Request) {
  try {
    const usuario = await exigirUsuario();
    const cuerpo = peticion.safeParse(await request.json().catch(() => null));

    if (!cuerpo.success) {
      return NextResponse.json({ error: 'Cambios mal formados.' }, { status: 400 });
    }

    const revision = await aplicarCambios(usuario.id, cuerpo.data.revision, cuerpo.data.cambios);
    return NextResponse.json({ revision });
  } catch (error) {
    return problema(error);
  }
}

async function problema(error: unknown) {
  if (error instanceof SinPermiso) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof RevisionVieja) {
    // Se devuelve el estado bueno junto con el conflicto para que el navegador
    // pueda recargar sin pedir un segundo viaje.
    const usuario = await exigirUsuario();
    return NextResponse.json(
      {
        error: error.message,
        revision: usuario.revision,
        datos: await leerEstado(usuario.id),
      },
      { status: 409 },
    );
  }

  console.error('Fallo en /api/estado', error);
  return NextResponse.json({ error: 'No se pudo guardar.' }, { status: 500 });
}
