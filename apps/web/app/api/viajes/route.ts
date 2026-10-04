import { problema, respuestaJson } from '@/servidor/respuesta';
import { exigirUsuario } from '@/servidor/sesion';
import { crearViaje, crearViajeSchema, listarViajes } from '@/servidor/viajes';
import { responderViaje } from '@/servidor/viajesRuta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Todos los viajes de los que soy parte, enteros: son pocos y así se pinta sin más viajes al servidor. */
export async function GET() {
  try {
    const usuario = await exigirUsuario();
    return respuestaJson({ yo: usuario.id, viajes: await listarViajes(usuario.id) });
  } catch (error) {
    return problema(error);
  }
}

export async function POST(request: Request) {
  return responderViaje(request, crearViajeSchema, (usuario, datos) => crearViaje(usuario.id, datos));
}
