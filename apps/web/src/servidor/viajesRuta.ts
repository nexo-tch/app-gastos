import type { z } from 'zod';
import { problema, respuestaJson } from '@/servidor/respuesta';
import { exigirUsuario, type Usuario } from '@/servidor/sesion';
import { ViajeError, type ViajeCompleto } from '@/servidor/viajes';

/**
 * Lo que repiten todos los endpoints de viajes: sesión, cuerpo validado, y el
 * viaje entero de vuelta para que el navegador pinte sin pedirlo otra vez.
 */
export async function responderViaje<T>(
  request: Request | null,
  esquema: z.ZodType<T, z.ZodTypeDef, unknown> | null,
  accion: (usuario: Usuario, datos: T) => Promise<ViajeCompleto>,
) {
  try {
    const usuario = await exigirUsuario();

    let datos = undefined as T;
    if (request && esquema) {
      const crudo = await request.json().catch(() => null);
      const validado = esquema.safeParse(crudo);
      if (!validado.success) {
        return respuestaJson({ error: 'Datos mal formados.' }, { status: 400 });
      }
      datos = validado.data;
    }

    const viaje = await accion(usuario, datos);
    return respuestaJson({ viaje });
  } catch (error) {
    if (error instanceof ViajeError) {
      return respuestaJson({ error: error.message }, { status: error.estado });
    }
    return problema(error);
  }
}
