/**
 * Lo minimo para que la app abra sin senal.
 *
 * No guarda datos: esos viven en la cuenta y en localStorage, y el propio
 * `almacen` sabe reintentar. Aqui solo se guarda la cascara, para que abrir
 * la app desde la pantalla de inicio no dependa de tener internet.
 *
 * La estrategia es red primero: si hay conexion siempre gana el servidor, de
 * modo que un despliegue nuevo llega enseguida. La copia es la red de
 * seguridad, no la fuente.
 */

const CACHE = 'gastos-/*__VERSION__*/';
const CASCARA = ['/', '/gastos.html', '/icono.svg'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CASCARA))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(nombres.filter((nombre) => nombre !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== location.origin) return;

  // Los datos y la sesion nunca se guardan: servir un estado viejo de la
  // cuenta seria peor que no responder.
  if (url.pathname.startsWith('/api/')) return;

  evento.respondWith(
    fetch(peticion)
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((cache) => cache.put(peticion, copia));
        }
        return respuesta;
      })
      .catch(() =>
        caches
          .match(peticion)
          .then((guardada) => guardada ?? caches.match('/gastos.html'))
          .then((guardada) => guardada ?? Response.error()),
      ),
  );
});

self.addEventListener('push', (evento) => {
  let datos = {
    title: 'Gastos',
    body: 'Tienes un aviso nuevo',
    url: '/gastos.html',
    badge: 1,
  };

  try {
    if (evento.data) datos = { ...datos, ...evento.data.json() };
  } catch {
    /* payload opcional */
  }

  const badge = Number(datos.badge) || 0;

  evento.waitUntil(
    Promise.all([
      self.registration.showNotification(datos.title, {
        body: datos.body,
        icon: '/icono-192.png',
        badge: '/icono-192.png',
        data: { url: datos.url ?? '/gastos.html' },
      }),
      typeof self.navigator?.setAppBadge === 'function'
        ? badge > 0
          ? self.navigator.setAppBadge(Math.min(badge, 99))
          : self.navigator.clearAppBadge()
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = evento.notification.data?.url ?? '/gastos.html';

  evento.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if ('focus' in cliente) {
          const url = new URL(cliente.url);
          if (url.pathname.endsWith('gastos.html') || url.pathname === '/') {
            if ('navigate' in cliente) cliente.navigate(destino);
            return cliente.focus();
          }
        }
      }
      return clients.openWindow(destino);
    }),
  );
});
