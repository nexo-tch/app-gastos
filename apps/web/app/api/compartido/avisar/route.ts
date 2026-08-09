import { z } from 'zod';
import { CompartidoInvalido } from '@/servidor/compartido';
import { entregarCompartidoInApp } from '@/servidor/notificaciones';
import { problema, respuestaJson } from '@/servidor/respuesta';
import { exigirUsuario } from '@/servidor/sesion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticion = z.object({
  repartoId: z.string().min(1).max(40),
});

export async function POST(request: Request) {
  try {
    const usuario = await exigirUsuario();
    const crudo = await request.json().catch(() => null);
    const datos = peticion.safeParse(crudo);
    if (!datos.success) {
      return respuestaJson({ error: 'Datos mal formados.' }, { status: 400 });
    }

    const { entregada } = await entregarCompartidoInApp(usuario.id, datos.data.repartoId);
    return respuestaJson({ ok: true, entregada });
  } catch (error) {
    if (error instanceof CompartidoInvalido) {
      return respuestaJson({ error: error.message }, { status: 404 });
    }
    return problema(error);
  }
}
