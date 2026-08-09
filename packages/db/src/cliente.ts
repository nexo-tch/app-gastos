import { sql, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { CERROJO, CREAR_BITACORA, bitacora } from './bitacora.js';
import * as esquema from './esquema.js';
import { MIGRACIONES } from './migraciones.js';

/**
 * El tipo comun a los dos motores. PGlite y postgres-js son dos sesiones
 * distintas sobre el mismo dialecto, asi que todo lo que se escribe contra
 * `Base` corre igual en desarrollo y en produccion.
 */
export type Base = PgDatabase<
  PgQueryResultHKT,
  typeof esquema,
  ExtractTablesWithRelations<typeof esquema>
>;

export { esquema };

let conexion: Promise<Base> | null = null;

/**
 * Con `GASTOS_DATABASE_URL` se conecta al Postgres de produccion; sin ella
 * levanta PGlite, que es Postgres compilado a WebAssembly y vive en una
 * carpeta local. No hay que instalar ni levantar nada para trabajar.
 *
 * El nombre lo decide el proveedor: la integracion de Neon con Vercel escribe
 * `<PREFIJO>_DATABASE_URL`, y el prefijo distingue esta app de las demas que
 * compartan la cuenta. Inventarse otro nombre obliga a copiar la cadena a
 * mano, y esa copia se queda vieja el dia que roten la contrasena.
 */
export function base(): Promise<Base> {
  conexion ??= conectar();
  return conexion;
}

/** Solo para las pruebas: cada una quiere su propia base en blanco. */
export function reiniciarConexion(): void {
  conexion = null;
}

async function conectar(): Promise<Base> {
  const url = process.env.GASTOS_DATABASE_URL?.trim();
  let db: Base;

  if (url) {
    const [{ drizzle }, { default: postgres }] = await Promise.all([
      import('drizzle-orm/postgres-js'),
      import('postgres'),
    ]);
    // `prepare: false` es obligatorio detras de un pooler en modo transaccion,
    // que es como Supabase y Neon sirven la conexion por defecto.
    const cliente = postgres(url, { prepare: false, max: 1 });
    db = drizzle(cliente, { schema: esquema }) as unknown as Base;
  } else {
    // Sin la variable, la app arrancaria sobre una base local que en un
    // servidor sin disco ni siquiera se puede crear, y donde se pudiera se
    // borraria con el siguiente despliegue. Mejor no arrancar y decir por que.
    if (process.env.VERCEL) {
      throw new Error(
        'Falta GASTOS_DATABASE_URL. En Vercel no hay disco para PGlite: ' +
          'conecta la base al proyecto con el prefijo GASTOS y vuelve a desplegar.',
      );
    }

    const [{ drizzle }, { PGlite }] = await Promise.all([
      import('drizzle-orm/pglite'),
      import('@electric-sql/pglite'),
    ]);
    const ruta = process.env.PGLITE_DIR?.trim() || '.datos/dev';

    // PGlite crea su carpeta, pero no la de encima, y la primera vez que
    // alguien clona el repositorio no existe ninguna de las dos.
    if (!ruta.includes('://')) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(ruta, { recursive: true });
    }

    db = drizzle(new PGlite(ruta), { schema: esquema }) as unknown as Base;
  }

  await migrar(db, { compartida: Boolean(url) });
  return db;
}

/**
 * Aplica lo que falte por aplicar. Corre al abrir la conexion, en los dos
 * motores, para que nadie tenga que acordarse de un paso previo.
 *
 * Todo va dentro de una transaccion, y eso no es un detalle: si una migracion
 * se corta a la mitad sin transaccion, las tablas quedan creadas pero sin
 * anotar, y a partir de ahi cada arranque vuelve a intentarlo y muere en la
 * primera tabla que ya existe. La base queda envenenada para siempre.
 *
 * Con Postgres de verdad se pide ademas un cerrojo, porque el servidor levanta
 * varias instancias a la vez y todas migran al arrancar. Es del ambito de la
 * transaccion a proposito: detras de un pooler en modo transaccion, que es
 * como sirven Supabase y Neon, cada sentencia suelta puede caer en una sesion
 * distinta, y un cerrojo de sesion no estaria protegiendo nada.
 */
export async function migrar(db: Base, { compartida = false } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    if (compartida) await tx.execute(sql`SELECT pg_advisory_xact_lock(${CERROJO})`);

    await tx.execute(sql.raw(CREAR_BITACORA));

    const hechas = new Set((await tx.select({ nombre: bitacora.nombre }).from(bitacora)).map((f) => f.nombre));

    for (const migracion of MIGRACIONES) {
      if (hechas.has(migracion.nombre)) continue;
      for (const sentencia of migracion.sentencias) await tx.execute(sql.raw(sentencia));
      await tx.insert(bitacora).values({ nombre: migracion.nombre });
    }
  });
}
