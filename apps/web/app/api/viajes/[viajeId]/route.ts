import { editarViaje, editarViajeSchema, leerViaje } from '@/servidor/viajes';
import { responderViaje } from '@/servidor/viajesRuta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ viajeId: string }> };

export async function GET(_request: Request, { params }: Contexto) {
  const { viajeId } = await params;
  return responderViaje(null, null, (usuario) => leerViaje(usuario.id, viajeId));
}

export async function PATCH(request: Request, { params }: Contexto) {
  const { viajeId } = await params;
  return responderViaje(request, editarViajeSchema, (usuario, datos) =>
    editarViaje(usuario.id, viajeId, datos),
  );
}
