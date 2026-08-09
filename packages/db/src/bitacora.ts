import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Que migraciones ya se aplicaron.
 *
 * Vive aparte del esquema a proposito: drizzle-kit mira `esquema.ts` para
 * generar migraciones, y una tabla que se crea antes de la primera migracion
 * no puede estar tambien dentro de ella.
 */
export const bitacora = pgTable('migraciones_aplicadas', {
  nombre: text('nombre').primaryKey(),
  aplicadaEn: timestamp('aplicada_en', { withTimezone: true }).notNull().defaultNow(),
});

export const CREAR_BITACORA = `
  CREATE TABLE IF NOT EXISTS "migraciones_aplicadas" (
    "nombre" text PRIMARY KEY,
    "aplicada_en" timestamp with time zone NOT NULL DEFAULT now()
  )
`;

/**
 * Numero arbitrario y fijo para el cerrojo de Postgres. Solo tiene que ser
 * siempre el mismo, para que dos arranques simultaneos pidan el mismo cerrojo.
 */
export const CERROJO = 4_073_219_551;
