/**
 * Los viajes son lo unico donde una cuenta escribe en filas que otras ven.
 * Estas pruebas cuidan sobre todo eso: que nadie de fuera entre, y que nadie
 * de dentro toque lo que no es suyo.
 */
import { computeTripBalances, simplifyDebts } from '@gastos/core';
import { base, reiniciarConexion } from '@gastos/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { crearCuenta } from './cuentas.js';
import {
  ViajeError,
  borrarGastoViaje,
  borrarPagoViaje,
  crearViaje,
  editarViaje,
  gastoViajeSchema,
  guardarGastoViaje,
  leerViaje,
  listarViajes,
  registrarPagoViaje,
  unirseAViaje,
  type ViajeCompleto,
} from './viajes.js';

beforeAll(async () => {
  delete process.env.GASTOS_DATABASE_DATABASE_URL;
  process.env.PGLITE_DIR = 'memory://';
  reiniciarConexion();
  await base();
});

let contador = 0;
const registrar = async (nombre: string) => {
  contador += 1;
  const resultado = await crearCuenta({
    correo: `${nombre.toLowerCase()}${contador}@viaje.com`,
    clave: 'unaClaveLarga',
    nombre,
  });
  if (!resultado.ok) throw new Error(resultado.error);
  return resultado.usuarioId;
};

const rechazo = async (promesa: Promise<unknown>, estado: number) => {
  const error = await promesa.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ViajeError);
  expect((error as ViajeError).estado).toBe(estado);
};

const gasto = (parcial: Record<string, unknown>) =>
  gastoViajeSchema.parse({
    descripcion: 'Entradas Camp Nou',
    categoria: 'actividades',
    moneda: 'EUR',
    montoTotal: 40_000,
    ocurrioEn: '2026-11-15',
    modo: 'equal',
    ...parcial,
  });

const saldos = (viaje: ViajeCompleto) =>
  computeTripBalances({
    memberIds: viaje.miembros.map((m) => m.id),
    baseCurrency: viaje.monedaBase,
    rates: viaje.tasas,
    expenses: viaje.gastos.map((g) => ({
      currency: g.moneda,
      totalCents: g.montoTotal,
      parts: g.partes.map((p) => ({ memberId: p.usuarioId, paidCents: p.pagado, owedCents: p.debe })),
    })),
    settlements: viaje.pagos.map((p) => ({ fromId: p.de, toId: p.a, amountCents: p.monto })),
  });

async function grupoDeCuatro() {
  const camilo = await registrar('Camilo');
  const andres = await registrar('Andrés');
  const leo = await registrar('Leo');
  const edxa = await registrar('Edxa');

  const viaje = await crearViaje(camilo, {
    nombre: 'Viaje a Europa',
    monedaBase: 'COP',
    tasas: { EUR: 4500 },
  });
  for (const quien of [andres, leo, edxa]) await unirseAViaje(quien, viaje.codigo);

  return { camilo, andres, leo, edxa, viaje };
}

describe('crear un viaje y unirse', () => {
  it('quien lo crea queda adentro y los demás entran con el código', async () => {
    const { camilo, andres, viaje } = await grupoDeCuatro();

    const visto = await leerViaje(andres, viaje.id);
    expect(visto.miembros.map((m) => m.nombre)).toEqual(['Camilo', 'Andrés', 'Leo', 'Edxa']);
    expect(visto.creadoPor).toBe(camilo);
    expect((await listarViajes(andres)).map((v) => v.id)).toContain(viaje.id);
  });

  it('unirse dos veces no duplica a nadie', async () => {
    const { andres, viaje } = await grupoDeCuatro();
    const otraVez = await unirseAViaje(andres, viaje.codigo);
    expect(otraVez.miembros).toHaveLength(4);
  });

  it('un código inventado no abre nada', async () => {
    const intruso = await registrar('Intruso');
    await rechazo(unirseAViaje(intruso, 'no-existe-123'), 404);
  });

  it('quien no es miembro no ve el viaje ni puede cargarle gastos', async () => {
    const { camilo, viaje } = await grupoDeCuatro();
    const intruso = await registrar('Intruso');

    await rechazo(leerViaje(intruso, viaje.id), 404);
    await rechazo(
      guardarGastoViaje(
        intruso,
        viaje.id,
        gasto({ pagadores: [{ usuarioId: camilo, monto: 40_000 }], participantes: [{ usuarioId: camilo }] }),
      ),
      404,
    );
    expect(await listarViajes(intruso)).toEqual([]);
  });

  it('las tasas y el nombre los cambia solo quien creó el viaje', async () => {
    const { camilo, andres, viaje } = await grupoDeCuatro();

    await rechazo(editarViaje(andres, viaje.id, { tasas: { EUR: 1 } }), 403);
    const editado = await editarViaje(camilo, viaje.id, { tasas: { EUR: 4600, USD: 4000 } });
    expect(editado.tasas).toEqual({ EUR: 4600, USD: 4000 });
  });
});

describe('gastos del viaje', () => {
  it('el ejemplo del Camp Nou: pago yo y los otros tres me deben', async () => {
    const { camilo, andres, leo, edxa, viaje } = await grupoDeCuatro();
    const todos = [camilo, andres, leo, edxa];

    const despues = await guardarGastoViaje(
      camilo,
      viaje.id,
      gasto({
        pagadores: [{ usuarioId: camilo, monto: 40_000 }],
        participantes: todos.map((usuarioId) => ({ usuarioId })),
      }),
    );

    // 400 € a 4.500: 1.800.000 pesos, 450.000 por cabeza.
    const balance = saldos(despues);
    expect(balance.find((b) => b.memberId === camilo)?.balanceCents).toBe(1_350_000_00);
    expect(simplifyDebts(balance)).toEqual(
      [andres, leo, edxa].map((fromId) => ({ fromId, toId: camilo, amountCents: 450_000_00 })),
    );
  });

  it('una cena que pagan dos personas', async () => {
    const { camilo, andres, leo, viaje } = await grupoDeCuatro();

    const despues = await guardarGastoViaje(
      andres,
      viaje.id,
      gasto({
        descripcion: 'Cena',
        categoria: 'comida',
        montoTotal: 9_000,
        pagadores: [
          { usuarioId: camilo, monto: 5_000 },
          { usuarioId: andres, monto: 4_000 },
        ],
        participantes: [{ usuarioId: camilo }, { usuarioId: andres }, { usuarioId: leo }],
      }),
    );

    const cena = despues.gastos[0]!;
    expect(cena.creadoPor).toBe(andres);
    expect(cena.partes.find((p) => p.usuarioId === camilo)).toMatchObject({ pagado: 5_000, debe: 3_000 });
    expect(cena.partes.find((p) => p.usuarioId === leo)).toMatchObject({ pagado: 0, debe: 3_000 });
  });

  it('por porcentaje guarda lo escrito para volver a editarlo', async () => {
    const { camilo, andres, viaje } = await grupoDeCuatro();

    const despues = await guardarGastoViaje(
      camilo,
      viaje.id,
      gasto({
        modo: 'percent',
        montoTotal: 10_000,
        pagadores: [{ usuarioId: camilo, monto: 10_000 }],
        participantes: [
          { usuarioId: camilo, porcentaje: 33.33 },
          { usuarioId: andres, porcentaje: 66.67 },
        ],
      }),
    );

    const partes = despues.gastos[0]!.partes;
    expect(partes.find((p) => p.usuarioId === camilo)).toMatchObject({ debe: 3_333, peso: 3333 });
    expect(partes.find((p) => p.usuarioId === andres)).toMatchObject({ debe: 6_667, peso: 6667 });
  });

  it('rechaza un gasto que no cuadra, o con alguien que no es del viaje', async () => {
    const { camilo, viaje } = await grupoDeCuatro();
    const intruso = await registrar('Intruso');

    await rechazo(
      guardarGastoViaje(
        camilo,
        viaje.id,
        gasto({ pagadores: [{ usuarioId: camilo, monto: 100 }], participantes: [{ usuarioId: camilo }] }),
      ),
      400,
    );
    await rechazo(
      guardarGastoViaje(
        camilo,
        viaje.id,
        gasto({
          pagadores: [{ usuarioId: camilo, monto: 40_000 }],
          participantes: [{ usuarioId: camilo }, { usuarioId: intruso }],
        }),
      ),
      400,
    );
  });

  it('no acepta una moneda sin tasa', async () => {
    const { camilo, viaje } = await grupoDeCuatro();
    await rechazo(
      guardarGastoViaje(
        camilo,
        viaje.id,
        gasto({
          moneda: 'GBP',
          pagadores: [{ usuarioId: camilo, monto: 40_000 }],
          participantes: [{ usuarioId: camilo }],
        }),
      ),
      400,
    );
  });

  it('solo quien registró el gasto puede cambiarlo o borrarlo', async () => {
    const { camilo, andres, viaje } = await grupoDeCuatro();
    const conGasto = await guardarGastoViaje(
      camilo,
      viaje.id,
      gasto({
        pagadores: [{ usuarioId: camilo, monto: 40_000 }],
        participantes: [{ usuarioId: camilo }, { usuarioId: andres }],
      }),
    );
    const idGasto = conGasto.gastos[0]!.id;

    await rechazo(
      guardarGastoViaje(
        andres,
        viaje.id,
        gasto({
          id: idGasto,
          pagadores: [{ usuarioId: andres, monto: 40_000 }],
          participantes: [{ usuarioId: camilo }],
        }),
      ),
      403,
    );
    await rechazo(borrarGastoViaje(andres, viaje.id, idGasto), 403);

    const editado = await guardarGastoViaje(
      camilo,
      viaje.id,
      gasto({
        id: idGasto,
        montoTotal: 50_000,
        pagadores: [{ usuarioId: camilo, monto: 50_000 }],
        participantes: [{ usuarioId: camilo }, { usuarioId: andres }],
      }),
    );
    expect(editado.gastos).toHaveLength(1);
    expect(editado.gastos[0]!.montoTotal).toBe(50_000);

    const borrado = await borrarGastoViaje(camilo, viaje.id, idGasto);
    expect(borrado.gastos).toEqual([]);
  });

  it('no deja quitar la tasa de una moneda que ya tiene gastos', async () => {
    const { camilo, viaje } = await grupoDeCuatro();
    await guardarGastoViaje(
      camilo,
      viaje.id,
      gasto({ pagadores: [{ usuarioId: camilo, monto: 40_000 }], participantes: [{ usuarioId: camilo }] }),
    );
    await rechazo(editarViaje(camilo, viaje.id, { tasas: {} }), 400);
  });
});

describe('pagos para saldar', () => {
  it('lo registra quien paga o quien recibe, y baja la deuda', async () => {
    const { camilo, andres, leo, viaje } = await grupoDeCuatro();
    await guardarGastoViaje(
      camilo,
      viaje.id,
      gasto({
        moneda: 'COP',
        montoTotal: 200_000_00,
        pagadores: [{ usuarioId: camilo, monto: 200_000_00 }],
        participantes: [{ usuarioId: camilo }, { usuarioId: andres }],
      }),
    );

    await rechazo(
      registrarPagoViaje(leo, viaje.id, { de: andres, a: camilo, monto: 100_000_00 }),
      403,
    );

    const pagado = await registrarPagoViaje(andres, viaje.id, { de: andres, a: camilo, monto: 100_000_00 });
    expect(saldos(pagado).every((b) => b.balanceCents === 0)).toBe(true);

    const idPago = pagado.pagos[0]!.id;
    await rechazo(borrarPagoViaje(camilo, viaje.id, idPago), 403);
    const sinPago = await borrarPagoViaje(andres, viaje.id, idPago);
    expect(sinPago.pagos).toEqual([]);
  });
});
