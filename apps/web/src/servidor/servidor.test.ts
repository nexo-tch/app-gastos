/**
 * Las pruebas del servidor corren contra Postgres de verdad: PGlite en
 * memoria, con el mismo esquema y las mismas migraciones que produccion. No
 * hay dobles ni bases falsas, asi que lo que pasa aqui pasa alli.
 */
import { base, esquema, reiniciarConexion } from '@gastos/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { cifrar, coincide } from './claves.js';
import { comprobarClave, crearCuenta } from './cuentas.js';
import { RevisionVieja, aplicarCambios, cambiosSchema, leerEstado, subirEstadoCompleto } from './estado.js';
import { borrarSesion, nuevaSesion, usuarioDeToken } from './sesion.js';

beforeAll(async () => {
  delete process.env.GASTOS_DATABASE_DATABASE_URL;
  process.env.PGLITE_DIR = 'memory://';
  reiniciarConexion();
  await base();
});

/** Los cambios que manda el navegador, ya validados como en el endpoint. */
const cambios = (parcial: Record<string, unknown>) => cambiosSchema.parse(parcial);

const registrar = async (correo: string) => {
  const resultado = await crearCuenta({ correo, clave: 'unaClaveLarga', nombre: 'Quien Sea' });
  if (!resultado.ok) throw new Error(resultado.error);
  return resultado.usuarioId;
};

describe('crear una cuenta', () => {
  it('deja la primera pantalla con categorías y formas de pago', async () => {
    const usuarioId = await registrar('nuevo@ejemplo.com');
    const estado = await leerEstado(usuarioId);

    expect(estado.categorias.length).toBe(15);
    expect(estado.cuentas.map((c) => c.id)).toEqual(['efectivo', 'debito', 'credito']);
    expect(estado.gastos).toEqual([]);
  });

  it('no admite dos cuentas con el mismo correo, ni cambiando mayúsculas', async () => {
    await registrar('repetido@ejemplo.com');

    const otra = await crearCuenta({
      correo: 'REPETIDO@Ejemplo.com',
      clave: 'unaClaveLarga',
      nombre: 'Otra',
    });

    expect(otra.ok).toBe(false);
  });

  it('no guarda la contraseña, solo lo que deriva de ella', async () => {
    const usuarioId = await registrar('secreto@ejemplo.com');
    const db = await base();
    const [fila] = await db
      .select({ clave: esquema.usuarios.clave })
      .from(esquema.usuarios)
      .where(eq(esquema.usuarios.id, usuarioId));

    expect(fila?.clave).not.toContain('unaClaveLarga');
    expect(fila?.clave.startsWith('scrypt$')).toBe(true);
  });
});

describe('entrar', () => {
  it('acepta la clave buena y rechaza la mala con el mismo mensaje que un correo que no existe', async () => {
    await registrar('entra@ejemplo.com');

    expect((await comprobarClave('entra@ejemplo.com', 'unaClaveLarga')).ok).toBe(true);

    const malaClave = await comprobarClave('entra@ejemplo.com', 'otraCosa');
    const sinCuenta = await comprobarClave('nadie@ejemplo.com', 'otraCosa');

    expect(malaClave.ok).toBe(false);
    expect(sinCuenta.ok).toBe(false);
    expect(malaClave).toEqual(sinCuenta);
  });

  it('dos veces la misma clave da dos hashes distintos y los dos abren', async () => {
    const uno = await cifrar('la misma clave');
    const otro = await cifrar('la misma clave');

    expect(uno).not.toBe(otro);
    expect(await coincide('la misma clave', uno)).toBe(true);
    expect(await coincide('la misma clave', otro)).toBe(true);
    expect(await coincide('otra clave', uno)).toBe(false);
  });
});

describe('la sesión', () => {
  it('vale hasta que se cierra, y un token inventado no vale nunca', async () => {
    const usuarioId = await registrar('sesion@ejemplo.com');
    const { token } = await nuevaSesion(usuarioId);

    expect((await usuarioDeToken(token))?.id).toBe(usuarioId);
    expect(await usuarioDeToken('esto-me-lo-invente')).toBe(null);

    await borrarSesion(token);
    expect(await usuarioDeToken(token)).toBe(null);
  });

  it('guarda la huella del token y no el token', async () => {
    const usuarioId = await registrar('huella@ejemplo.com');
    const { token } = await nuevaSesion(usuarioId);

    const db = await base();
    const filas = await db
      .select({ huella: esquema.sesiones.huella })
      .from(esquema.sesiones)
      .where(eq(esquema.sesiones.usuarioId, usuarioId));

    expect(filas).toHaveLength(1);
    expect(filas[0]?.huella).not.toBe(token);
  });
});

describe('guardar y volver a leer', () => {
  it('devuelve el gasto tal como se mandó, con su reparto y su presupuesto', async () => {
    const usuarioId = await registrar('guarda@ejemplo.com');

    await aplicarCambios(
      usuarioId,
      0,
      cambios({
        personas: { puestos: [{ id: 'p1', name: 'Ana', posicion: 0 }] },
        gastos: {
          puestos: [
            {
              id: 'g1',
              accountId: 'debito',
              categoryId: 'mercado',
              amountTotalCents: 18_500_00,
              myShareCents: 9_250_00,
              merchantRaw: 'Éxito',
              merchantNormalized: 'EXITO',
              occurredAt: '2026-08-02T12:00:00-05:00',
            },
          ],
        },
        repartos: {
          puestos: [{ id: 'r1', expenseId: 'g1', personId: 'p1', amountCents: 9_250_00 }],
        },
        presupuestos: {
          puestos: [{ mes: '2026-08', totalCents: 3_500_000_00, limites: { mercado: 800_000_00 } }],
        },
      }),
    );

    const estado = await leerEstado(usuarioId);
    const gasto = estado.gastos[0];

    expect(estado.gastos).toHaveLength(1);
    expect(gasto?.amountTotalCents).toBe(18_500_00);
    expect(gasto?.myShareCents).toBe(9_250_00);
    expect(gasto?.merchantRaw).toBe('Éxito');
    // La fecha vuelve en UTC, pero es el mismo instante que se mandó.
    expect(new Date(gasto!.occurredAt).toISOString()).toBe('2026-08-02T17:00:00.000Z');

    expect(estado.repartos).toHaveLength(1);
    expect(estado.presupuestos['2026-08']).toEqual({
      totalCents: 3_500_000_00,
      limites: { mercado: 800_000_00 },
    });
  });

  it('guarda el correo opcional de una persona', async () => {
    const usuarioId = await registrar('correo-persona@ejemplo.com');

    await aplicarCambios(
      usuarioId,
      0,
      cambios({
        personas: {
          puestos: [{ id: 'p1', name: 'edxa', email: 'Ed@Ejemplo.com', posicion: 0 }],
        },
      }),
    );

    expect((await leerEstado(usuarioId)).personas[0]).toEqual({
      id: 'p1',
      name: 'edxa',
      email: 'ed@ejemplo.com',
    });
  });

  it('guarda lo que le debo a alguien y que ya se lo pagué', async () => {
    const usuarioId = await registrar('debo@ejemplo.com');

    await aplicarCambios(
      usuarioId,
      0,
      cambios({
        personas: { puestos: [{ id: 'p1', name: 'Ana', posicion: 0 }] },
        deudas: {
          puestos: [
            {
              id: 'd1',
              personId: 'p1',
              amountCents: 60_000_00,
              description: 'Mercado',
              occurredAt: '2026-08-08T12:00:00-05:00',
            },
          ],
        },
      }),
    );

    const deuda = (await leerEstado(usuarioId)).deudas[0];
    expect(deuda?.amountCents).toBe(60_000_00);
    expect(deuda?.description).toBe('Mercado');
    expect(deuda?.settledAt).toBe(null);

    await aplicarCambios(
      usuarioId,
      1,
      cambios({
        deudas: {
          puestos: [
            {
              id: 'd1',
              personId: 'p1',
              amountCents: 60_000_00,
              description: 'Mercado',
              occurredAt: '2026-08-08T12:00:00-05:00',
              settledAt: '2026-08-10T12:00:00-05:00',
            },
          ],
        },
      }),
    );

    expect((await leerEstado(usuarioId)).deudas[0]?.settledAt).toBe('2026-08-10T17:00:00.000Z');
  });

  it('quitar un tope del mes lo borra de la base', async () => {
    const usuarioId = await registrar('topes@ejemplo.com');

    await aplicarCambios(
      usuarioId,
      0,
      cambios({
        presupuestos: {
          puestos: [{ mes: '2026-08', totalCents: 100, limites: { mercado: 50, ropa: 20 } }],
        },
      }),
    );

    await aplicarCambios(
      usuarioId,
      1,
      cambios({
        presupuestos: { puestos: [{ mes: '2026-08', totalCents: 100, limites: { mercado: 50 } }] },
      }),
    );

    expect((await leerEstado(usuarioId)).presupuestos['2026-08']?.limites).toEqual({ mercado: 50 });
  });

  it('rechaza el guardado si otro dispositivo escribió primero', async () => {
    const usuarioId = await registrar('conflicto@ejemplo.com');

    const revision = await aplicarCambios(
      usuarioId,
      0,
      cambios({ personas: { puestos: [{ id: 'p1', name: 'Ana', posicion: 0 }] } }),
    );
    expect(revision).toBe(1);

    // El segundo dispositivo todavía cree estar en la revisión cero.
    await expect(
      aplicarCambios(
        usuarioId,
        0,
        cambios({ personas: { puestos: [{ id: 'p2', name: 'Carlos', posicion: 1 }] } }),
      ),
    ).rejects.toBeInstanceOf(RevisionVieja);

    expect((await leerEstado(usuarioId)).personas).toHaveLength(1);
  });
});

describe('dos cuentas no se tocan', () => {
  it('cada quien ve lo suyo y nadie puede escribir en lo ajeno', async () => {
    const yo = await registrar('yo@ejemplo.com');
    const otro = await registrar('otro@ejemplo.com');

    const gasto = {
      id: 'compartido',
      categoryId: 'mercado',
      amountTotalCents: 1000,
      myShareCents: 1000,
      merchantRaw: 'Mío',
      occurredAt: '2026-08-02T12:00:00-05:00',
    };

    await aplicarCambios(yo, 0, cambios({ gastos: { puestos: [gasto] } }));

    expect((await leerEstado(otro)).gastos).toEqual([]);

    // El otro manda un gasto con el mismo identificador: como la llave lleva
    // el usuario, crea el suyo en vez de pisar el mío.
    await aplicarCambios(
      otro,
      0,
      cambios({ gastos: { puestos: [{ ...gasto, merchantRaw: 'Ajeno', amountTotalCents: 9999 }] } }),
    );

    expect((await leerEstado(yo)).gastos[0]?.merchantRaw).toBe('Mío');
    expect((await leerEstado(otro)).gastos[0]?.merchantRaw).toBe('Ajeno');

    // Y borrar tampoco cruza la frontera.
    await aplicarCambios(otro, 1, cambios({ gastos: { quitados: ['compartido'] } }));

    expect((await leerEstado(yo)).gastos).toHaveLength(1);
    expect((await leerEstado(otro)).gastos).toHaveLength(0);
  });
});

describe('subir copia completa', () => {
  it('persiste una copia exportada entera de un solo viaje', async () => {
    const fs = await import('node:fs');
    const ruta = process.env.GASTOS_FIXTURE ?? '/Users/mileniopc/Downloads/gastos-2026-08-09.json';
    if (!fs.existsSync(ruta)) return;

    const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    const usuarioId = await registrar('usuario-real@ejemplo.com');

    await subirEstadoCompleto(usuarioId, 0, datos);

    const leido = await leerEstado(usuarioId);
    expect(leido.gastos.length).toBe(19);
    expect(leido.personas.length).toBe(9);
    expect(leido.repartos.length).toBe(21);
    expect(leido.fijos.length).toBe(10);
  });
});
