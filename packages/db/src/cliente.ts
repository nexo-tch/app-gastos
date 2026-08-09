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
 * Con `DATABASE_APP_GASTOS_URL` se conecta al Postgres de produccion; sin
 * ella levanta PGlite, que es Postgres compilado a WebAssembly y vive en una
 * carpeta local. No hay que instalar ni levantar nada para trabajar.
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
  const url = process.env.DATABASE_APP_GASTOS_URL?.trim();
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
 * Con Postgres de verdad se pide antes un cerrojo: si el servidor arranca
 * varias instancias a la vez, todas intentan migrar y sin cerrojo se pisan.
 * La que lo consigue migra y las demas esperan y no encuentran nada que hacer.
 */
export async function migrar(db: Base, { compartida = false } = {}): Promise<void> {
  await db.execute(sql.raw(CREAR_BITACORA));

  if (compartida) await db.execute(sql`SELECT pg_advisory_lock(${CERROJO})`);

  try {
    const hechas = new Set((await db.select({ nombre: bitacora.nombre }).from(bitacora)).map((f) => f.nombre));

    for (const migracion of MIGRACIONES) {
      if (hechas.has(migracion.nombre)) continue;
      for (const sentencia of migracion.sentencias) await db.execute(sql.raw(sentencia));
      await db.insert(bitacora).values({ nombre: migracion.nombre });
    }
  } finally {
    if (compartida) await db.execute(sql`SELECT pg_advisory_unlock(${CERROJO})`);
  }
}
