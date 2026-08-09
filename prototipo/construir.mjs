/**
 * Arma la aplicacion. De un mismo juego de fuentes salen dos cosas:
 *
 *   prototipo/gastos.html   un archivo suelto que se abre con doble clic y
 *                           guarda todo en el navegador, sin servidor
 *   apps/web/public/        lo que sirve Next: la app, la pantalla de entrada,
 *                           el manifiesto, los iconos y el service worker
 *
 * Es el mismo HTML en los dos sitios. La diferencia la nota la propia app al
 * arrancar: si no hay `fetch` o esta abierta como archivo, trabaja sin cuenta.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconoPng, iconoSvg } from './src/icono.mjs';

const raiz = dirname(fileURLToPath(import.meta.url));
const fuente = join(raiz, 'src');
const publico = join(raiz, '..', 'apps', 'web', 'public');

/* ── El motor de packages/core, empaquetado para el navegador ────── */

const paquete = await build({
  entryPoints: [join(fuente, 'motor.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
});

const motor = paquete.outputFiles[0].text;

const [plantilla, estilos, app, plantillaEntrar, entrar, sw] = await Promise.all([
  readFile(join(fuente, 'plantilla.html'), 'utf8'),
  readFile(join(fuente, 'estilos.css'), 'utf8'),
  readFile(join(fuente, 'app.js'), 'utf8'),
  readFile(join(fuente, 'entrar.html'), 'utf8'),
  readFile(join(fuente, 'entrar.js'), 'utf8'),
  readFile(join(fuente, 'sw.js'), 'utf8'),
]);

// `$&` en el reemplazo tiene significado especial, por eso se usa la forma de funcion.
const insertar = (texto, marca, contenido) => {
  if (!texto.includes(marca)) throw new Error(`Falta la marca ${marca} en la plantilla`);
  return texto.replace(marca, () => contenido);
};

/* ── Temas que se pueden forzar ──────────────────────────────────── */

/**
 * El tema oscuro se declara una sola vez, dentro de su media query, que es
 * como debe ser. Pero para revisar el diseño hay que poder ver los dos sin
 * cambiar la configuracion del sistema operativo, asi que aqui se copian esas
 * mismas fichas a un selector que se enciende a mano con
 * `<html data-tema="oscuro">`.
 *
 * Se copia en vez de escribirse dos veces a proposito: dos listas de colores
 * mantenidas en paralelo terminan diciendo cosas distintas.
 *
 * Lo copiado se pega al final de la hoja, asi que le gana a todo lo que tenga
 * su misma especificidad. Por eso los bloques marcados solo pueden traer
 * color: una medida ahi dentro pisaria a las media queries que la ajustan.
 */
function conTemasForzables(css) {
  const claras = bloqueTras(css, '/* colores: claro */');
  const oscuras = bloqueTras(css, '/* colores: oscuro */');

  return `${css}
/* Generado por construir.mjs a partir de los bloques de arriba. No editar. */
:root[data-tema='claro'] {
  color-scheme: light;
${claras}}

:root[data-tema='oscuro'] {
  color-scheme: dark;
${oscuras}}
`;
}

/** Lo que hay entre las llaves de la regla que sigue a una marca. */
function bloqueTras(css, marca) {
  const encontrada = css.indexOf(marca);
  if (encontrada < 0) throw new Error(`Los estilos ya no tienen "${marca}"`);

  const abre = css.indexOf('{', encontrada);
  if (abre < 0) throw new Error(`Despues de "${marca}" no hay ninguna regla`);

  let nivel = 0;
  for (let i = abre; i < css.length; i += 1) {
    if (css[i] === '{') nivel += 1;
    else if (css[i] === '}') {
      nivel -= 1;
      if (nivel === 0) return css.slice(abre + 1, i);
    }
  }

  throw new Error(`El bloque de "${marca}" no cierra`);
}

const hoja = conTemasForzables(estilos.trim());

/* ── Las dos pantallas ───────────────────────────────────────────── */

let html = plantilla;
html = insertar(html, '/*__ESTILOS__*/', hoja);
html = insertar(html, '/*__MOTOR__*/', motor.trim());
html = insertar(html, '/*__APP__*/', app.trim());

let portada = plantillaEntrar;
portada = insertar(portada, '/*__ESTILOS__*/', hoja);
portada = insertar(portada, '/*__ENTRAR__*/', entrar.trim());

/* ── Manifiesto, iconos y service worker ─────────────────────────── */

const manifiesto = {
  name: 'Gastos',
  short_name: 'Gastos',
  description: 'Cuánto te queda este mes, en qué se te va y quién te debe.',
  lang: 'es-CO',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  icons: [
    { src: '/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

// El nombre del cache lleva la huella de la app: cada compilacion estrena
// cache y el telefono no se queda con la version de la semana pasada.
const version = createHash('sha256').update(html).digest('hex').slice(0, 10);

await mkdir(publico, { recursive: true });

await Promise.all([
  writeFile(join(raiz, 'gastos.html'), html, 'utf8'),
  writeFile(join(publico, 'gastos.html'), html, 'utf8'),
  writeFile(join(publico, 'entrar.html'), portada, 'utf8'),
  writeFile(join(publico, 'gastos.webmanifest'), JSON.stringify(manifiesto, null, 2), 'utf8'),
  writeFile(join(publico, 'sw.js'), insertar(sw, '/*__VERSION__*/', version), 'utf8'),
  writeFile(join(publico, 'icono.svg'), iconoSvg, 'utf8'),
  writeFile(join(publico, 'icono-180.png'), iconoPng(180)),
  writeFile(join(publico, 'icono-192.png'), iconoPng(192)),
  writeFile(join(publico, 'icono-512.png'), iconoPng(512)),
]);

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`Listo: prototipo/gastos.html y apps/web/public (${kb} KB, version ${version}).`);
