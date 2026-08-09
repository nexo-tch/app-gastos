/**
 * Herramienta de desarrollo: levanta `gastos.html` con datos de ejemplo ya
 * cargados para poder mirarlo (o fotografiarlo) sin tener que sembrar a mano.
 *
 *   node prototipo/vista-previa.mjs        → sirve en http://localhost:4321
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO ?? 4321);

const html = await readFile(join(raiz, 'gastos.html'), 'utf8');

/** Corre la app en un DOM simulado solo para cosechar los datos de ejemplo. */
function sembrar() {
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      const dialogo = window.HTMLDialogElement?.prototype;
      if (dialogo) {
        dialogo.showModal = function () {
          this.open = true;
        };
        dialogo.close = function () {
          this.open = false;
        };
      }
    },
  });

  const boton = dom.window.document.getElementById('datos-ejemplo');
  boton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  const datos = dom.window.localStorage.getItem('gastos.prototipo.v1');
  dom.window.close();
  return datos;
}

const semilla = sembrar();

/** `?tope=1200000` cambia lo que hay para el mes, para ver los casos extremos. */
function conTope(pesos) {
  const datos = JSON.parse(semilla);
  for (const presupuesto of Object.values(datos.presupuestos)) {
    presupuesto.totalCents = Math.round(Number(pesos) * 100);
  }
  return JSON.stringify(datos);
}

/**
 * `SIN_SERVIDOR` le dice a la app que aqui no hay cuenta ni API: se queda con
 * los datos sembrados en vez de pedirlos y encontrarse un 404.
 */
const paginaCon = (datos) =>
  html.replace(
    '<script>',
    `<script>window.SIN_SERVIDOR=true;` +
      `localStorage.setItem('gastos.prototipo.v1', ${JSON.stringify(datos)});</script>\n<script>`,
  );

const conDatos = paginaCon(semilla);

/** `?abrir=gasto` o `?vista=personas` dejan la pantalla lista para fotografiarla. */
const abridor = (selector) =>
  `<script>addEventListener('load',()=>document.querySelector('${selector}').click());</script>`;

/** `?medir=1` delata a los elementos que se salen del ancho de la pantalla. */
const medidor = `<script>addEventListener('load',()=>{
  const ancho = document.documentElement.clientWidth;
  const culpables = [...document.querySelectorAll('*')]
    .map((n) => ({ n, caja: n.getBoundingClientRect() }))
    .filter(({ caja }) => caja.right > ancho + 1 || caja.left < -1)
    .map(({ n, caja }) => n.tagName.toLowerCase() + '.' + (n.className || '?') + ' → ' + Math.round(caja.right));
  document.title = 'ancho=' + ancho + ' | scroll=' + document.documentElement.scrollWidth;
  const salida = document.createElement('pre');
  salida.id = 'medicion';
  salida.textContent = document.title + '\\n' + culpables.slice(0, 25).join('\\n');
  document.body.appendChild(salida);
});</script>`;

createServer((peticion, respuesta) => {
  const url = new URL(peticion.url, `http://localhost:${PUERTO}`);
  const abrir = url.searchParams.get('abrir');
  const verVista = url.searchParams.get('vista');
  const tope = url.searchParams.get('tope');
  let salida = tope ? paginaCon(conTope(tope)) : conDatos;

  // `?tema=oscuro` fuerza el tema sin tener que cambiar el sistema operativo,
  // que es la única forma de fotografiar los dos en la misma sesión.
  const tema = url.searchParams.get('tema');
  if (tema === 'claro' || tema === 'oscuro') {
    salida = salida.replace('<html lang="es">', `<html lang="es" data-tema="${tema}">`);
  }

  // La pestaña primero: el botón a abrir puede vivir dentro de esa vista.
  if (verVista) {
    salida = salida.replace('</body>', `${abridor(`.pestana[data-vista="${verVista}"]`)}</body>`);
  }
  if (abrir) salida = salida.replace('</body>', `${abridor(`[data-abrir="${abrir}"]`)}</body>`);
  if (url.searchParams.get('medir')) salida = salida.replace('</body>', `${medidor}</body>`);
  respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  respuesta.end(salida);
}).listen(PUERTO, () => {
  console.log(`Vista previa con datos de ejemplo en http://localhost:${PUERTO}`);
});
