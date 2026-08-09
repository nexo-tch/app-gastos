/**
 * Prueba de humo del prototipo: carga `gastos.html` en un DOM simulado y
 * recorre los caminos que se usan todos los días. No reemplaza probarlo a mano,
 * pero atrapa el error que dejaría la pantalla en blanco.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const html = await readFile(join(raiz, 'gastos.html'), 'utf8');

const fallos = [];
const consola = new VirtualConsole();
consola.on('jsdomError', (error) => fallos.push(error.stack ?? String(error)));
consola.on('error', (...args) => fallos.push(args.join(' ')));

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: consola,
  beforeParse(window) {
    // jsdom no implementa diálogos modales ni los avisos del navegador.
    const dialogo = window.HTMLDialogElement?.prototype;
    if (dialogo) {
      dialogo.showModal = function () {
        this.open = true;
      };
      dialogo.close = function () {
        this.open = false;
      };
    }
    window.confirm = () => true;
    window.prompt = () => 'Invitado';
    window.addEventListener('error', (evento) => fallos.push(evento.error?.stack ?? evento.message));
  },
});

const { window } = dom;
const doc = window.document;

const clic = (selector) => {
  const nodo = doc.querySelector(selector);
  if (!nodo) throw new Error(`No existe ${selector}`);
  nodo.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};

const escribir = (selector, valor, tipo = 'input') => {
  const nodo = doc.querySelector(selector);
  if (!nodo) throw new Error(`No existe ${selector}`);
  nodo.value = valor;
  nodo.dispatchEvent(new window.Event(tipo, { bubbles: true }));
};

const texto = (selector) => doc.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() ?? '';

const pruebas = [];
const comprobar = (nombre, condicion, detalle = '') => {
  pruebas.push({ nombre, bien: Boolean(condicion), detalle });
};

/* ── 1. Arranca en limpio ───────────────────────────────────────── */

comprobar('la cabecera dibuja el tablero', texto('#tablero').length > 0);
comprobar('sin datos invita a registrar', texto('#lienzo').includes('Todavía no hay nada'));

/* ── 2. Datos de ejemplo ────────────────────────────────────────── */

clic('#datos-ejemplo');

const guardado = () => JSON.parse(window.localStorage.getItem('gastos.prototipo.v1'));

comprobar('crea gastos de ejemplo', guardado().gastos.length === 10, `${guardado().gastos.length}`);
comprobar('crea dos personas', guardado().personas.length === 2);
comprobar('crea dos gastos fijos', guardado().fijos.length === 2);
comprobar(
  'reserva los fijos del mes desde el día 1',
  guardado().instancias.filter((i) => i.status === 'planned').length === 2,
);
comprobar('el tablero muestra lo que queda', texto('#tablero').includes('Te queda para el mes'));
comprobar('la barra marca el día de hoy', doc.querySelector('.barra__hoy') !== null);
comprobar('aparece el desglose por categoría', texto('#lienzo').includes('En qué se te va'));
comprobar('aparece quién te debe', texto('#lienzo').includes('Ana'));

/* ── 3. El presupuesto solo cuenta mi parte ─────────────────────── */

const datos = guardado();
const totalRegistrado = datos.gastos.reduce((s, g) => s + g.amountTotalCents, 0);
const miParte = datos.gastos.reduce((s, g) => s + g.myShareCents, 0);
comprobar('mi parte es menor que el total registrado', miParte < totalRegistrado);

/* ── 4. Registrar un gasto compartido ───────────────────────────── */

clic('[data-abrir="gasto"]');
comprobar('el diálogo de gasto se abre', doc.querySelector('#dialogo-gasto').open === true);

escribir('#gasto-monto', '60000');
clic('[data-categoria="mercado"]');
escribir('#gasto-comercio', 'Carulla');

const fichasPersona = doc.querySelectorAll('#gasto-personas [data-persona]');
comprobar('las personas aparecen como fichas', fichasPersona.length === 2);

fichasPersona[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

comprobar(
  'en partes iguales el gasto se divide entre dos',
  texto('#reparto-resultado').includes('30.000'),
  texto('#reparto-resultado'),
);

doc.querySelector('#forma-gasto').dispatchEvent(
  new window.Event('submit', { bubbles: true, cancelable: true }),
);

comprobar('el gasto queda guardado', guardado().gastos.length === 11);
comprobar('queda un reparto nuevo', guardado().repartos.length > datos.repartos.length);

const ultimo = guardado().gastos.at(-1);
comprobar('guarda el total completo', ultimo.amountTotalCents === 6000000, String(ultimo.amountTotalCents));
comprobar('guarda solo mi parte aparte', ultimo.myShareCents === 3000000, String(ultimo.myShareCents));

/* ── 5. Cobrar: un abono se reparte del más viejo al más nuevo ──── */

clic('.pestana[data-vista="personas"]');
comprobar('la vista de personas lista a Ana', texto('#lienzo').includes('Ana'));
const tarjetaAna = [...doc.querySelectorAll('#lienzo .persona')].find((n) =>
  n.querySelector('.persona__nombre')?.textContent.includes('Ana'),
);
comprobar(
  'el monto que te deben no se repite en la tarjeta de Ana',
  (tarjetaAna?.textContent.match(/Te debe/g) ?? []).length === 1,
);
comprobar('la tarjeta no muestra el correo en pantalla', !tarjetaAna?.textContent.includes('@'));

const ana = guardado().personas.find((p) => p.name === 'Ana');
comprobar('Ana todavía no tiene correo', !ana?.email);
clic(`[data-editar-correo-persona="${ana.id}"]`);
comprobar('el diálogo de correo se abre', doc.querySelector('#dialogo-correo-persona').open === true);
doc.getElementById('correo-persona').value = 'ana@ejemplo.com';
doc.querySelector('#forma-correo-persona').dispatchEvent(
  new window.Event('submit', { bubbles: true, cancelable: true }),
);
comprobar(
  'se puede asociar correo a una persona existente',
  guardado().personas.find((p) => p.id === ana.id)?.email === 'ana@ejemplo.com',
);
const tarjetaAnaActualizada = [...doc.querySelectorAll('#lienzo .persona')].find((n) =>
  n.querySelector('.persona__nombre')?.textContent.includes('Ana'),
);
comprobar('el correo no queda visible en la tarjeta', !tarjetaAnaActualizada?.textContent.includes('@'));

/* ── 5c. Registrar manualmente lo que le debes ─────────────────── */

clic(`[data-debo-persona="${ana.id}"]`);
comprobar('el diálogo de deuda manual se abre', doc.querySelector('#dialogo-debo').open === true);

doc.getElementById('debo-descripcion').value = 'Hamburguesa';
escribir('#debo-monto', '25000');
doc.querySelector('#forma-debo').dispatchEvent(
  new window.Event('submit', { bubbles: true, cancelable: true }),
);

comprobar(
  'queda apuntado lo que le debes',
  guardado().deudas.some((d) => d.description === 'Hamburguesa' && d.amountCents === 2500000),
);
comprobar(
  'entra en tus gastos del mes',
  guardado().gastos.some((g) => g.merchantRaw === 'Hamburguesa' && g.myShareCents === 2500000),
);

clic('.pestana[data-vista="resumen"]');
comprobar('el resumen lista lo que debes', texto('#lienzo').includes('Debes'));
comprobar('el tablero muestra cuánto debes', texto('#tablero').includes('Yo debo'));

clic('.pestana[data-vista="personas"]');

clic('[data-abonar]');
comprobar('el diálogo de abono se abre', doc.querySelector('#dialogo-abono').open === true);

escribir('#abono-monto', '20000');
comprobar('propone cómo aplicar el abono', texto('#abono-reparto').includes('Se aplica así'));

doc.querySelector('#forma-abono').dispatchEvent(
  new window.Event('submit', { bubbles: true, cancelable: true }),
);

comprobar('el abono queda registrado', guardado().abonos.length === 1);
comprobar('el abono se asigna a gastos concretos', guardado().asignaciones.length > 0);

/* ── 5b. Avisarle a la otra persona de su parte ─────────────────── */

comprobar('cada deuda ofrece avisarle', doc.querySelector('[data-avisar]') !== null);

clic('[data-avisar]');
comprobar('la hoja de avisar se abre', doc.querySelector('#dialogo-avisar').open === true);

const mensaje = texto('#avisar-mensaje');
comprobar('el mensaje dice de cuánto es la parte', /Te toca \$/.test(mensaje), mensaje.slice(0, 70));
comprobar('el mensaje lleva el enlace para abrirlo', mensaje.includes('#compartido='));
comprobar(
  'sin poder compartir, ofrece copiar',
  texto('#avisar-enviar') === 'Copiar mensaje',
  texto('#avisar-enviar'),
);

const enlaceCompartido = mensaje.match(/#compartido=[\w-]+/)?.[0] ?? '';
comprobar('el enlace no viaja vacío', enlaceCompartido.length > 20);

clic('#dialogo-avisar [data-cerrar]');

/* ── 5c. Recibirlo en la app de la otra persona ─────────────────── */

await revisarRecibido(enlaceCompartido, guardado());

/* ── 6. Presupuesto y fijos ─────────────────────────────────────── */

clic('.pestana[data-vista="presupuesto"]');
comprobar('el tope del mes se puede editar', doc.querySelector('[data-presupuesto-total]') !== null);

escribir('[data-tope="ropa"]', '200.000', 'change');
comprobar('el tope por categoría se guarda', guardado().presupuestos[mesActual()].limites.ropa === 20000000);

/* ── 6b. Crear, editar, quitar y restaurar categorías ───────────── */

const cuantasCategorias = () => guardado().categorias.length;
const antesDeCrear = cuantasCategorias();

clic('[data-abrir="categoria"]');
comprobar('el diálogo de categoría se abre', doc.querySelector('#dialogo-categoria').open === true);
comprobar('ofrece una paleta de colores', doc.querySelectorAll('#categoria-colores .color').length > 5);

escribir('#categoria-nombre', 'Gimnasio');

// El color se lee de la muestra que se toca, no se escribe aquí: la paleta es
// del motor y esta prueba es sobre "guarda el que elegiste", no sobre cuál es.
const muestra = doc.querySelectorAll('#categoria-colores .color')[3];
const colorElegido = muestra.dataset.color;
muestra.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

doc.querySelector('#forma-categoria').dispatchEvent(
  new window.Event('submit', { bubbles: true, cancelable: true }),
);

comprobar('la categoría nueva se guarda', cuantasCategorias() === antesDeCrear + 1);
const gimnasio = guardado().categorias.at(-1);
comprobar('respeta el color elegido', gimnasio.color === colorElegido, gimnasio.color);
comprobar('la categoría nueva aparece en la lista', texto('#lienzo').includes('Gimnasio'));

clic('[data-abrir="categoria"]');
escribir('#categoria-nombre', 'Mercado');
doc.querySelector('#forma-categoria').dispatchEvent(
  new window.Event('submit', { bubbles: true, cancelable: true }),
);
comprobar('no deja repetir el nombre de otra categoría', cuantasCategorias() === antesDeCrear + 1);

clic(`[data-editar-categoria="${gimnasio.id}"]`);
escribir('#categoria-nombre', 'Gimnasio y deporte');
doc.querySelector('#forma-categoria').dispatchEvent(
  new window.Event('submit', { bubbles: true, cancelable: true }),
);
comprobar(
  'renombrar una categoría no crea otra',
  cuantasCategorias() === antesDeCrear + 1 &&
    guardado().categorias.find((c) => c.id === gimnasio.id).name === 'Gimnasio y deporte',
);

clic(`[data-borrar-categoria="${gimnasio.id}"]`);
comprobar('una categoría sin gastos se elimina de verdad', cuantasCategorias() === antesDeCrear);

clic('[data-borrar-categoria="mercado"]');
const mercado = guardado().categorias.find((c) => c.id === 'mercado');
comprobar('una categoría con gastos se guarda, no se borra', mercado.isArchived === true);
comprobar(
  'los gastos de esa categoría siguen ahí',
  guardado().gastos.some((g) => g.categoryId === 'mercado' && !g.deletedAt),
);
comprobar('deja de aparecer entre las editables', !texto('#lienzo').includes('Tope de Mercado'));

clic('[data-restaurar-categoria="mercado"]');
comprobar(
  'restaurarla la devuelve a la lista',
  guardado().categorias.find((c) => c.id === 'mercado').isArchived === false,
);

clic('.pestana[data-vista="fijos"]');
comprobar('los fijos del mes se listan', texto('#lienzo').includes('Arriendo'));

const antesDePagar = guardado().gastos.length;
clic('[data-pagar]');
comprobar('pagar un fijo crea el gasto', guardado().gastos.length === antesDePagar + 1);
comprobar(
  'el fijo pagado deja de estar reservado',
  guardado().instancias.filter((i) => i.status === 'planned').length === 1,
);

/* ── 7. Fijos que no caben en el mes ────────────────────────────── */

clic('.pestana[data-vista="presupuesto"]');

// Un techo que alcanza para lo ya gastado pero no para los fijos que faltan.
const estado = guardado();
const gastadoDelMes = estado.gastos
  .filter((g) => !g.deletedAt)
  .reduce((suma, g) => suma + g.myShareCents, 0);
const reservadoEnFijos = estado.instancias
  .filter((i) => i.status === 'planned')
  .reduce((suma, i) => suma + i.plannedCents, 0);

const enPesos = (centavos) => new Intl.NumberFormat('es-CO').format(Math.round(centavos / 100));

comprobar('el ejemplo deja fijos sin pagar', reservadoEnFijos > 0);
escribir('[data-presupuesto-total]', enPesos(gastadoDelMes + reservadoEnFijos / 2), 'change');

comprobar(
  'no dice que te pasaste si no has gastado de más',
  !texto('#tablero').includes('Te pasaste por'),
  texto('#tablero').slice(0, 60),
);
comprobar('avisa que los fijos no caben', texto('#tablero').includes('Te faltan para los fijos'));
comprobar(
  'explica cómo arreglarlo',
  texto('#tablero').includes('no caben en los') && texto('#tablero').includes('ajusta algún fijo'),
);

// El otro extremo: gastar de verdad más de lo que hay sí debe decir "te pasaste".
escribir('[data-presupuesto-total]', enPesos(gastadoDelMes / 2), 'change');
comprobar('gastar de más sí se llama gastar de más', texto('#tablero').includes('Te pasaste por'));

escribir('[data-presupuesto-total]', enPesos(gastadoDelMes + reservadoEnFijos * 2), 'change');
comprobar('con plata suficiente vuelve a lo normal', texto('#tablero').includes('Te queda para el mes'));

/* ── 8. Un fijo con tope en su categoría no se cuenta dos veces ─── */

clic('.pestana[data-vista="presupuesto"]');
escribir('[data-tope="servicios"]', '300.000', 'change');
clic('.pestana[data-vista="resumen"]');

/** La fila de Servicios en el desglose "En qué se te va". */
const filaServicios = () => {
  const fila = [...doc.querySelectorAll('#lienzo .categoria')].find((n) =>
    n.textContent.includes('Servicios'),
  );
  return fila ? fila.textContent.replace(/\s+/g, ' ').trim() : '(no aparece)';
};

comprobar(
  'el fijo reservado consume el tope de su categoría',
  filaServicios().includes('$ 220.000 / $ 300.000'),
  filaServicios(),
);

clic('.pestana[data-vista="fijos"]');
clic('[data-pagar]');
clic('.pestana[data-vista="resumen"]');

comprobar(
  'al pagarlo pasa de reservado a gastado, no se suma dos veces',
  filaServicios().includes('$ 220.000 / $ 300.000'),
  filaServicios(),
);
comprobar(
  'y deja de estar reservado',
  guardado().instancias.every((i) => i.status !== 'planned'),
);

/* ── 9. Navegar entre meses ─────────────────────────────────────── */

clic('.pestana[data-vista="resumen"]');
clic('[data-mes="-1"]');
comprobar('el mes anterior está vacío', texto('#lienzo').includes('Todavía no hay nada'));
comprobar(
  'un mes que ya pasó no reserva gastos fijos',
  guardado().instancias.every((i) => i.month >= mesActual()),
);
clic('[data-mes="1"]');
comprobar('vuelve al mes actual', texto('#tablero').includes('Te queda para el mes'));

function mesActual() {
  const fecha = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* ── 10. La pantalla de entrada ─────────────────────────────────── */

await revisarEntrada();

/**
 * Es la unica pantalla que puede dejar a alguien fuera de sus datos, y su
 * fallo natural es silencioso: un aviso que se pinta y se borra solo no se ve
 * en ninguna captura.
 */
async function revisarEntrada() {
  const portada = await readFile(join(raiz, '..', 'apps', 'web', 'public', 'entrar.html'), 'utf8');

  const ventana = new JSDOM(portada, {
    url: 'http://localhost/entrar?crear',
    runScripts: 'dangerously',
    virtualConsole: consola,
    beforeParse(window) {
      // El servidor dice que no, que es justo cuando el aviso importa.
      window.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Ese correo y esa clave no coinciden.' }),
      });
    },
  }).window;

  const dentro = ventana.document;

  comprobar('al crear cuenta el cursor empieza en el nombre', dentro.activeElement?.id === 'nombre');

  dentro.getElementById('cambiar').click();
  comprobar('cambiar a entrar esconde el nombre', dentro.getElementById('campo-nombre').hidden);
  comprobar('y mueve el cursor al correo', dentro.activeElement?.id === 'correo');

  dentro.getElementById('correo').value = 'quien@ejemplo.com';
  dentro.getElementById('clave').value = 'la que no es';
  dentro.getElementById('forma').dispatchEvent(new ventana.Event('submit', { bubbles: true, cancelable: true }));

  // La respuesta y el repintado del boton pasan en microtareas encadenadas.
  await new Promise((listo) => setTimeout(listo, 0));

  const aviso = dentro.getElementById('error');
  comprobar('el motivo del rechazo se queda en pantalla', !aviso.hidden, aviso.textContent);
  comprobar('el botón vuelve a poder pulsarse', !dentro.getElementById('enviar').disabled);

  ventana.close();
}

/**
 * El otro lado del enlace: alguien lo abre en su propio navegador, sin nada
 * guardado, y decide si esa parte entra en sus cuentas.
 *
 * Va en ventanas aparte porque el enlace se lee al arrancar y porque son de
 * verdad dos personas distintas, cada una con sus datos.
 */
async function revisarRecibido(enlace, delQueComparte) {
  const abrir = (previo) =>
    new JSDOM(html, {
      url: `http://localhost/${enlace}`,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: consola,
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
        window.confirm = () => true;
        if (previo) window.localStorage.setItem('gastos.prototipo.v1', JSON.stringify(previo));
        window.addEventListener('error', (evento) =>
          fallos.push(evento.error?.stack ?? evento.message),
        );
      },
    }).window;

  // Se decodifica aquí, con otras herramientas que las del navegador, para
  // comprobar que lo que viaja es base64url de verdad y no algo que solo
  // entiende quien lo escribió.
  const crudo = enlace.replace('#compartido=', '').replace(/-/g, '+').replace(/_/g, '/');
  const carga = JSON.parse(Buffer.from(crudo, 'base64').toString('utf8'));

  const reparto = delQueComparte.repartos.find((r) => r.id === carga.i);
  comprobar(
    'el enlace lleva la parte que se repartió, no el total',
    carga.c === reparto?.amountCents && carga.t > carga.c,
    `${carga.c} de ${carga.t}`,
  );

  let ventana = abrir(null);
  const suTexto = (selector) =>
    ventana.document.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  const suClic = (selector) =>
    ventana.document
      .querySelector(selector)
      .dispatchEvent(new ventana.MouseEvent('click', { bubbles: true }));
  const suyo = () => JSON.parse(ventana.localStorage.getItem('gastos.prototipo.v1'));

  comprobar(
    'el enlace abre la ficha de lo que le compartieron',
    ventana.document.querySelector('#dialogo-recibido').open === true,
  );
  comprobar('la ficha dice cuánto le toca', suTexto('#recibido-resumen').includes(carga.q));
  comprobar(
    'y deja elegir en qué lo cuenta',
    ventana.document.querySelectorAll('#recibido-categorias [data-categoria-recibido]').length > 5,
  );

  suClic('#recibido-agregar');

  comprobar('agregarlo le crea un gasto', suyo().gastos.length === 1);
  comprobar(
    'con su parte y nada más',
    suyo().gastos[0].myShareCents === carga.c && suyo().gastos[0].amountTotalCents === carga.c,
    `${suyo().gastos[0].amountTotalCents}`,
  );
  comprobar(
    'en la misma categoría que le pusieron, si la tiene',
    suyo().gastos[0].categoryId === 'mercado',
    `${suyo().gastos[0].categoryId} (venía "${carga.k}")`,
  );
  comprobar(
    'y le queda apuntado que se la debe',
    suyo().deudas.length === 1 && suyo().deudas[0].amountCents === carga.c,
  );
  comprobar('con la persona a la que se la debe', suyo().personas.length === 1);
  comprobar('la tarjeta de esa persona lo dice', suTexto('#lienzo').includes('Le debes'));
  comprobar('recargar no vuelve a preguntar lo mismo', ventana.location.hash === '');

  const suEstado = suyo();
  ventana.close();

  // Un enlace se reenvía, se abre dos veces, se toca sin querer.
  ventana = abrir(suEstado);
  suClic('#recibido-agregar');

  comprobar(
    'abrir el mismo enlace otra vez no duplica el gasto ni la deuda',
    suyo().gastos.length === 1 && suyo().deudas.length === 1 && suyo().personas.length === 1,
    `${suyo().gastos.length} gastos, ${suyo().deudas.length} deudas`,
  );

  const idGastoCompartido = suyo().gastos[0].id;
  suClic('.pestana[data-vista="gastos"]');
  suClic(`[data-gasto="${idGastoCompartido}"]`);
  suClic('#gasto-eliminar');
  comprobar('borrar el gasto compartido quita la deuda ligada', suyo().deudas.length === 0);
  comprobar('el gasto queda eliminado', suyo().gastos[0].deletedAt !== null);
  suClic('.pestana[data-vista="personas"]');
  comprobar('Personas deja de decir Le debes', !suTexto('#lienzo').includes('Le debes'));

  ventana.close();

  // Si ya tenías a esa persona con otro nombre pero su correo de cuenta, no duplica.
  const previoConCorreo = JSON.parse(JSON.stringify(delQueComparte));
  previoConCorreo.personas = [{ id: 'amigo', name: 'edxa', email: 'quien@ejemplo.com' }];
  previoConCorreo.gastos = [];
  previoConCorreo.repartos = [];
  previoConCorreo.deudas = [];
  const cargaConCorreo = { ...carga, de: 'Ed', dc: 'quien@ejemplo.com' };
  const enlaceConCorreo = `#compartido=${Buffer.from(JSON.stringify(cargaConCorreo))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`;
  ventana = abrir(previoConCorreo);
  ventana.close();
  ventana = new JSDOM(html, {
    url: `http://localhost/${enlaceConCorreo}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: consola,
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
      window.confirm = () => true;
      window.localStorage.setItem('gastos.prototipo.v1', JSON.stringify(previoConCorreo));
    },
  }).window;
  ventana.document
    .querySelector('#recibido-agregar')
    ?.dispatchEvent(new ventana.MouseEvent('click', { bubbles: true }));
  const suyoCorreo = () => JSON.parse(ventana.localStorage.getItem('gastos.prototipo.v1'));
  comprobar(
    'el correo de la cuenta reconoce a la persona aunque el nombre no coincida',
    suyoCorreo().personas.length === 1 && suyoCorreo().personas[0].name === 'edxa',
    `${suyoCorreo().personas.length} personas, nombre ${suyoCorreo().personas[0]?.name}`,
  );
  ventana.close();
}

/* ── 11. Lo que se crea sube a la cuenta ────────────────────────── */

await revisarSincronizacion();

/**
 * Sin esto la app solo guarda en localStorage: al recargar, si el servidor
 * no recibió nada, los datos desaparecen.
 */
async function revisarSincronizacion() {
  let revision = 0;
  const cuentaVacia = () => ({
    version: 1,
    cuentas: [
      { id: 'efectivo', name: 'Efectivo', kind: 'cash' },
      { id: 'debito', name: 'Débito', kind: 'debit' },
      { id: 'credito', name: 'Tarjeta de crédito', kind: 'credit' },
    ],
    categorias: [
      { id: 'mercado', name: 'Mercado', color: '#4A9D5B', isArchived: false },
      { id: 'salidas-comer', name: 'Salidas a comer y domicilios', color: '#E2653C', isArchived: false },
    ],
    personas: [],
    gastos: [],
    repartos: [],
    abonos: [],
    asignaciones: [],
    deudas: [],
    presupuestos: {},
    fijos: [],
    instancias: [],
  });
  let servidor = cuentaVacia();
  const envios = [];

  const ventana = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: consola,
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
      window.confirm = () => true;
      window.addEventListener('error', (evento) => fallos.push(evento.error?.stack ?? evento.message));

      window.fetch = async (url, init = {}) => {
        if (url === '/api/estado' && (!init.method || init.method === 'GET')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              revision,
              nombre: 'Ana',
              correo: 'ana@ejemplo.com',
              datos: JSON.parse(JSON.stringify(servidor)),
            }),
          };
        }

        if (url === '/api/estado' && init.method === 'PUT') {
          const cuerpo = JSON.parse(init.body);
          envios.push(cuerpo);
          revision += 1;
          for (const persona of cuerpo.cambios.personas.puestos) {
            const indice = servidor.personas.findIndex((p) => p.id === persona.id);
            const fila = { id: persona.id, name: persona.name };
            if (indice >= 0) servidor.personas[indice] = fila;
            else servidor.personas.push(fila);
          }
          return { ok: true, status: 200, json: async () => ({ revision }) };
        }

        throw new Error(`fetch sin simular: ${url} ${init.method ?? 'GET'}`);
      };
    },
  }).window;

  const doc = ventana.document;
  const clicSync = (selector) =>
    doc.querySelector(selector).dispatchEvent(new ventana.MouseEvent('click', { bubbles: true }));

  await new Promise((listo) => setTimeout(listo, 0));
  await new Promise((listo) => setTimeout(listo, 0));

  clicSync('.pestana[data-vista="personas"]');
  clicSync('[data-mostrar-nueva-persona]');
  doc.querySelector('[data-nueva-persona] [name="nombre"]').value = 'Julie';
  doc.querySelector('[data-nueva-persona]').dispatchEvent(
    new ventana.Event('submit', { bubbles: true, cancelable: true }),
  );

  await new Promise((listo) => setTimeout(listo, 900));

  comprobar('crear una persona dispara un guardado en la cuenta', envios.length > 0);
  comprobar(
    'el envío incluye a la persona nueva',
    envios.some((envio) => envio.cambios.personas.puestos.some((p) => p.name === 'Julie')),
  );
  comprobar('el servidor la recibe', servidor.personas.some((p) => p.name === 'Julie'));

  ventana.close();
}

/* ── Resultado ──────────────────────────────────────────────────── */

const malas = pruebas.filter((p) => !p.bien);

for (const prueba of pruebas) {
  console.log(`${prueba.bien ? '  ok  ' : ' FALLA'}  ${prueba.nombre}${prueba.detalle ? ` → ${prueba.detalle}` : ''}`);
}

if (fallos.length > 0) {
  console.log('\nErrores en la consola del navegador:');
  for (const fallo of fallos) console.log(`  ${fallo}`);
}

console.log(`\n${pruebas.length - malas.length}/${pruebas.length} comprobaciones pasan.`);

if (malas.length > 0 || fallos.length > 0) process.exit(1);
