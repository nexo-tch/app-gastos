/**
 * El icono de la app, dibujado a mano.
 *
 * Android e iOS piden PNG y no aceptan SVG para el icono de la pantalla de
 * inicio. En vez de meter binarios en el repositorio, que nadie sabe editar
 * despues, se generan en cada compilacion desde el mismo par de colores que
 * usa la interfaz. Son cincuenta lineas y ahorran una dependencia grafica.
 *
 * El dibujo es el rombo de la marca sobre el verde de fondo, a sangre y sin
 * esquinas redondeadas: los dos sistemas recortan el icono con su propia
 * mascara, y una esquina redonda dentro de otra queda fea.
 */
import { deflateSync } from 'node:zlib';

const FONDO = [0x14, 0x58, 0x4c];
const ROMBO = [0xf4, 0xf1, 0xe8];

/** El rombo ocupa el 60% del ancho: deja margen para la mascara de Android. */
const RADIO = 0.3;

export function iconoPng(tamano) {
  const pixeles = Buffer.alloc(tamano * tamano * 4);
  const centro = (tamano - 1) / 2;
  const radio = tamano * RADIO;

  for (let y = 0; y < tamano; y += 1) {
    for (let x = 0; x < tamano; x += 1) {
      const cobertura = cubrimientoDelRombo(x, y, centro, radio);
      const salida = (y * tamano + x) * 4;

      for (let canal = 0; canal < 3; canal += 1) {
        pixeles[salida + canal] = Math.round(
          FONDO[canal] * (1 - cobertura) + ROMBO[canal] * cobertura,
        );
      }
      pixeles[salida + 3] = 255;
    }
  }

  return empaquetar(tamano, tamano, pixeles);
}

/**
 * Cuanto del pixel cae dentro del rombo, de 0 a 1. Se mide con cuatro muestras
 * por lado en vez de una: sin esto los bordes en diagonal salen escalonados.
 */
function cubrimientoDelRombo(x, y, centro, radio) {
  const MUESTRAS = 4;
  let dentro = 0;

  for (let sy = 0; sy < MUESTRAS; sy += 1) {
    for (let sx = 0; sx < MUESTRAS; sx += 1) {
      const px = x + (sx + 0.5) / MUESTRAS - 0.5;
      const py = y + (sy + 0.5) / MUESTRAS - 0.5;
      if (Math.abs(px - centro) + Math.abs(py - centro) <= radio) dentro += 1;
    }
  }

  return dentro / (MUESTRAS * MUESTRAS);
}

/* ── El formato PNG, en lo minimo que hace falta ─────────────────── */

const TABLA_CRC = Array.from({ length: 256 }, (_, indice) => {
  let valor = indice;
  for (let bit = 0; bit < 8; bit += 1) {
    valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
  }
  return valor >>> 0;
});

function crc32(datos) {
  let valor = 0xffffffff;
  for (const byte of datos) valor = TABLA_CRC[(valor ^ byte) & 0xff] ^ (valor >>> 8);
  return (valor ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);

  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const suma = Buffer.alloc(4);
  suma.writeUInt32BE(crc32(cuerpo));

  return Buffer.concat([largo, cuerpo, suma]);
}

function empaquetar(ancho, alto, pixeles) {
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8; // ocho bits por canal
  cabecera[9] = 6; // color con transparencia
  // Los tres ceros que siguen son compresion, filtro e interlazado estandar.

  // Cada linea va precedida por su byte de filtro; con 0 se guarda tal cual.
  const crudo = Buffer.alloc((ancho * 4 + 1) * alto);
  for (let y = 0; y < alto; y += 1) {
    crudo[y * (ancho * 4 + 1)] = 0;
    pixeles.copy(crudo, y * (ancho * 4 + 1) + 1, y * ancho * 4, (y + 1) * ancho * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', cabecera),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

export const iconoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#14584C" />
  <path d="M32 12.8 51.2 32 32 51.2 12.8 32Z" fill="#F4F1E8" />
</svg>
`;
