import { z } from 'zod';
import { CompartidoInvalido, marcarCompartidoAceptado } from '@/servidor/compartido';
import { problema, respuestaJson } from '@/servidor/respuesta';
import { exigirUsuario } from '@/servidor/sesion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticion = z.object({
  repartoId: z.string().min(1).max(40),
  emisorCorreo: z.string().email(),
  montoCentavos: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    await exigirUsuario();
    const crudo = await request.json().catch(() => null);
    const datos = peticion.safeParse(crudo);
    if (!datos.success) {
      return respuestaJson({ error: 'Datos mal formados.' }, { status: 400 });
    }

    const actualizado = await marcarCompartidoAceptado(datos.data);
    return respuestaJson({ ok: true, actualizado });
  } catch (error) {
    if (error instanceof CompartidoInvalido) {
      return respuestaJson({ error: error.message }, { status: 404 });
    }
    return problema(error);
  }
}
