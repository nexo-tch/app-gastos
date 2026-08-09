import { NextResponse } from 'next/server';
import { z } from 'zod';
import { crearCuenta } from '@/servidor/cuentas';
import { abrirSesion } from '@/servidor/sesion';

export const runtime = 'nodejs';

const peticion = z.object({
  correo: z.string().email().max(160),
  clave: z.string().min(8).max(200),
  nombre: z.string().trim().min(1).max(80),
});

export async function POST(request: Request) {
  const cuerpo = peticion.safeParse(await request.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json(
      { error: 'Revisa el correo, el nombre y que la clave tenga al menos 8 caracteres.' },
      { status: 400 },
    );
  }

  const resultado = await crearCuenta(cuerpo.data);
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: 409 });

  await abrirSesion(resultado.usuarioId);
  return NextResponse.json({ ok: true });
}
