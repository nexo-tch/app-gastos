import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Contrasenas con scrypt de la libreria estandar de Node.
 *
 * No usa bcrypt ni argon2 a proposito: los dos traen binarios nativos que hay
 * que compilar por plataforma y se rompen al desplegar. scrypt viene en Node,
 * es lento a proposito y esta pensado para resistir hardware dedicado.
 */

const derivar = promisify(scrypt) as (
  clave: string,
  sal: Buffer,
  largo: number,
  opciones: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Unos 100 ms por intento en un servidor normal. */
const COSTO = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LARGO = 32;

/** El resultado se guarda con sus parametros: si manana suben, los viejos siguen abriendo. */
export async function cifrar(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await derivar(normalizar(clave), sal, LARGO, COSTO);
  return [
    'scrypt',
    COSTO.N,
    COSTO.r,
    COSTO.p,
    sal.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export async function coincide(clave: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const [, textoN, textoR, textoP, textoSal, textoHash] = partes;
  const sal = Buffer.from(textoSal ?? '', 'base64url');
  const esperado = Buffer.from(textoHash ?? '', 'base64url');
  if (sal.length === 0 || esperado.length === 0) return false;

  const candidato = await derivar(normalizar(clave), sal, esperado.length, {
    N: Number(textoN),
    r: Number(textoR),
    p: Number(textoP),
    maxmem: COSTO.maxmem,
  });

  return candidato.length === esperado.length && timingSafeEqual(candidato, esperado);
}

/**
 * Una tilde escrita con acento combinante y otra con caracter compuesto se ven
 * iguales en pantalla pero son bytes distintos. Sin esto, una contrasena con
 * enes o tildes puede fallar segun el teclado con el que se escriba.
 */
const normalizar = (clave: string) => clave.normalize('NFKC');
