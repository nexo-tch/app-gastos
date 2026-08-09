import { NextResponse, type NextRequest } from 'next/server';

/**
 * El portero de la puerta, no el de la caja fuerte.
 *
 * Corre en el runtime Edge, donde no hay `node:crypto` ni base de datos, asi
 * que solo puede mirar si la galleta existe. Quien valida de verdad la sesion
 * es cada endpoint: aqui solo se decide a que pantalla mandar a alguien para
 * que no vea una app vacia ni un formulario de entrada estando dentro.
 */

const GALLETA = 'gastos_sesion';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const tieneSesion = request.cookies.has(GALLETA);

  if (pathname === '/entrar') {
    if (tieneSesion) return NextResponse.redirect(new URL('/', request.url));
    return reescribir(request, '/entrar.html');
  }

  if (pathname === '/') {
    if (!tieneSesion) return NextResponse.redirect(new URL('/entrar', request.url));
    return reescribir(request, '/gastos.html');
  }

  return NextResponse.next();
}

/**
 * Las dos pantallas son HTML generado por el mismo `construir.mjs` del
 * prototipo, servido desde `public/`. Se reescribe en vez de redirigir para
 * que la barra de direcciones diga `/` y no `/gastos.html`.
 */
function reescribir(request: NextRequest, destino: string) {
  const respuesta = NextResponse.rewrite(new URL(destino, request.url));
  // Sin esto la CDN se queda con una copia y un despliegue nuevo no llega.
  respuesta.headers.set('cache-control', 'no-cache, must-revalidate');
  return respuesta;
}

export const config = {
  matcher: ['/', '/entrar'],
};
