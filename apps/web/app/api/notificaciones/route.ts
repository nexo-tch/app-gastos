import { z } from 'zod';
import {
  listarNotificacionesPendientes,
  marcarNotificacionLeida,
} from '@/servidor/notificaciones';
import { problema, respuestaJson } from '@/servidor/respuesta';
import { exigirUsuario } from '@/servidor/sesion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const marcarLeida = z.object({
  id: z.string().min(1).max(40),
});

export async function GET() {
  try {
    const usuario = await exigirUsuario();
    const notificaciones = await listarNotificacionesPendientes(usuario.id);
    return respuestaJson({ notificaciones });
  } catch (error) {
    return problema(error);
  }
}

export async function POST(request: Request) {
  try {
    const usuario = await exigirUsuario();
    const crudo = await request.json().catch(() => null);
    const datos = marcarLeida.safeParse(crudo);
    if (!datos.success) {
      return respuestaJson({ error: 'Datos mal formados.' }, { status: 400 });
    }

    const actualizada = await marcarNotificacionLeida(usuario.id, datos.data.id);
    return respuestaJson({ ok: true, actualizada });
  } catch (error) {
    return problema(error);
  }
}
