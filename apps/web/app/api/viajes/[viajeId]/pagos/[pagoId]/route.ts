import { borrarPagoViaje } from '@/servidor/viajes';
import { responderViaje } from '@/servidor/viajesRuta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ viajeId: string; pagoId: string }> };

export async function DELETE(_request: Request, { params }: Contexto) {
  const { viajeId, pagoId } = await params;
  return responderViaje(null, null, (usuario) => borrarPagoViaje(usuario.id, viajeId, pagoId));
}
