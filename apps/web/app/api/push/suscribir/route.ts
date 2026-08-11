import { z } from 'zod';
import { guardarSuscripcionPush } from '@/servidor/push';
import { problema, respuestaJson } from '@/servidor/respuesta';
import { exigirUsuario } from '@/servidor/sesion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const suscripcion = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: Request) {
  try {
    const usuario = await exigirUsuario();
    const crudo = await request.json().catch(() => null);
    const datos = suscripcion.safeParse(crudo);
    if (!datos.success) {
      return respuestaJson({ error: 'Suscripción mal formada.' }, { status: 400 });
    }

    const guardada = await guardarSuscripcionPush(usuario.id, datos.data);
    return respuestaJson({ ok: guardada });
  } catch (error) {
    return problema(error);
  }
}
