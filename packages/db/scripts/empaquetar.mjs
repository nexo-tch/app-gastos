/**
 * Convierte las migraciones que escribe drizzle-kit en un modulo de TypeScript
 * con el SQL adentro.
 *
 * El migrador que trae drizzle lee la carpeta en tiempo de ejecucion, y eso no
 * sobrevive a un empaquetador: Next compila el servidor y la carpeta ya no
 * esta donde estaba. Con el SQL incrustado da igual quien empaquete y donde
 * corra, y las migraciones viajan con el codigo.
 *
 * Corre solo, pegado a `drizzle-kit generate`, para que no exista la version
 * en la que alguien genera el SQL y olvida empaquetarlo.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const carpeta = join(raiz, 'migraciones');
const destino = join(raiz, 'src', 'migraciones.ts');

const archivos = (await readdir(carpeta))
  .filter((nombre) => nombre.endsWith('.sql'))
  .sort();

const migraciones = await Promise.all(
  archivos.map(async (archivo) => {
    const crudo = await readFile(join(carpeta, archivo), 'utf8');
    return {
      nombre: archivo.replace(/\.sql$/, ''),
      // Postgres no acepta varias sentencias en un mismo mensaje del protocolo
      // extendido, que es el que usan los dos motores. drizzle-kit ya deja
      // marcada la separacion.
      sentencias: crudo
        .split('--> statement-breakpoint')
        .map((sentencia) => sentencia.trim())
        .filter(Boolean),
    };
  }),
);

const cuerpo = migraciones
  .map(
    (migracion) => `  {
    nombre: ${JSON.stringify(migracion.nombre)},
    sentencias: [
${migracion.sentencias.map((s) => `      ${JSON.stringify(s)},`).join('\n')}
    ],
  },`,
  )
  .join('\n');

await writeFile(
  destino,
  `/**
 * Generado por scripts/empaquetar.mjs a partir de migraciones/*.sql.
 * No editar a mano: se reescribe con cada \`npm run generar\`.
 */
export interface Migracion {
  nombre: string;
  sentencias: string[];
}

export const MIGRACIONES: Migracion[] = [
${cuerpo}
];
`,
  'utf8',
);

const sentencias = migraciones.reduce((suma, m) => suma + m.sentencias.length, 0);
console.log(`Empaquetadas ${migraciones.length} migraciones (${sentencias} sentencias).`);
