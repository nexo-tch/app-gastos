import { pagoViajeSchema, registrarPagoViaje } from '@/servidor/viajes';
import { responderViaje } from '@/servidor/viajesRuta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ viajeId: string }> };

export async function POST(request: Request, { params }: Contexto) {
  const { viajeId } = await params;
  return responderViaje(request, pagoViajeSchema, (usuario, datos) =>
    registrarPagoViaje(usuario.id, viajeId, datos),
  );
}
