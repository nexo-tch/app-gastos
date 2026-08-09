/**
 * Freno para los intentos de entrada.
 *
 * Vive en memoria del proceso, asi que en un servidor con varias instancias
 * cada una lleva su propia cuenta. No pretende parar un ataque distribuido:
 * para eso ya esta scrypt, que hace cada intento lento a proposito. Esto es
 * para que nadie pruebe mil claves seguidas desde una pestana.
 */

const VENTANA = 15 * 60 * 1000;
const TOPE = 10;

const intentos = new Map<string, { fallos: number; desde: number }>();

export function frenado(llave: string): boolean {
  const registro = intentos.get(llave);
  if (!registro) return false;
  if (Date.now() - registro.desde > VENTANA) {
    intentos.delete(llave);
    return false;
  }
  return registro.fallos >= TOPE;
}

export function anotarFallo(llave: string): void {
  const registro = intentos.get(llave);
  if (!registro || Date.now() - registro.desde > VENTANA) {
    intentos.set(llave, { fallos: 1, desde: Date.now() });
    return;
  }
  registro.fallos += 1;

  // Sin esto la tabla crece con cada correo que alguien invente.
  if (intentos.size > 5000) {
    for (const [clave, valor] of intentos) {
      if (Date.now() - valor.desde > VENTANA) intentos.delete(clave);
    }
  }
}

export function olvidarFallos(llave: string): void {
  intentos.delete(llave);
}
