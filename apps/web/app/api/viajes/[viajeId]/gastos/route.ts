import { gastoViajeSchema, guardarGastoViaje } from '@/servidor/viajes';
import { responderViaje } from '@/servidor/viajesRuta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ viajeId: string }> };

/** Crea el gasto, o lo reemplaza si llega con `id` y es de quien lo manda. */
export async function POST(request: Request, { params }: Contexto) {
  const { viajeId } = await params;
  return responderViaje(request, gastoViajeSchema, (usuario, datos) =>
    guardarGastoViaje(usuario.id, viajeId, datos),
  );
}
