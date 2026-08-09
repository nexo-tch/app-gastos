import { NextResponse } from 'next/server';
import { z } from 'zod';
import { comprobarClave, normalizarCorreo } from '@/servidor/cuentas';
import { anotarFallo, frenado, olvidarFallos } from '@/servidor/freno';
import { abrirSesion } from '@/servidor/sesion';

export const runtime = 'nodejs';

const peticion = z.object({
  correo: z.string().email().max(160),
  clave: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const cuerpo = peticion.safeParse(await request.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json({ error: 'Faltan el correo o la clave.' }, { status: 400 });
  }

  const correo = normalizarCorreo(cuerpo.data.correo);

  if (frenado(correo)) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' },
      { status: 429 },
    );
  }

  const resultado = await comprobarClave(correo, cuerpo.data.clave);

  if (!resultado.ok) {
    anotarFallo(correo);
    return NextResponse.json({ error: resultado.error }, { status: 401 });
  }

  olvidarFallos(correo);
  await abrirSesion(resultado.usuarioId);
  return NextResponse.json({ ok: true });
}
