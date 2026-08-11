import { claveVapidPublica } from '@/servidor/push';
import { respuestaJson } from '@/servidor/respuesta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return respuestaJson({ publicKey: claveVapidPublica() });
}
