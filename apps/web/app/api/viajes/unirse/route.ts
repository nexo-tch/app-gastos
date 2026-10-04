import { z } from 'zod';
import { unirseAViaje } from '@/servidor/viajes';
import { responderViaje } from '@/servidor/viajesRuta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticion = z.object({ codigo: z.string().min(4).max(40) });

export async function POST(request: Request) {
  return responderViaje(request, peticion, (usuario, datos) => unirseAViaje(usuario.id, datos.codigo));
}
