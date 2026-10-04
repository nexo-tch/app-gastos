import { borrarGastoViaje } from '@/servidor/viajes';
import { responderViaje } from '@/servidor/viajesRuta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ viajeId: string; gastoId: string }> };

export async function DELETE(_request: Request, { params }: Contexto) {
  const { viajeId, gastoId } = await params;
  return responderViaje(null, null, (usuario) => borrarGastoViaje(usuario.id, viajeId, gastoId));
}
