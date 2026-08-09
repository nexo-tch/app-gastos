export interface CategorySeed {
  slug: string;
  name: string;
  icon: string;
  color: string;
}

/**
 * Arranque con categorias utiles; el usuario puede crear las que falten.
 *
 * Los colores son una paleta propia y no los tonos de fabrica de ninguna
 * libreria: todos rondan la misma luminosidad media, para que ninguna
 * categoria grite mas que las otras y para que los quince se distingan tanto
 * sobre el papel claro como sobre el fondo oscuro. Esta lista es tambien la
 * paleta que se ofrece al crear una categoria nueva.
 */
export const DEFAULT_CATEGORIES: readonly CategorySeed[] = [
  { slug: 'salidas-comer', name: 'Salidas a comer', icon: 'utensils', color: '#E2653C' },
  { slug: 'mercado', name: 'Mercado', icon: 'shopping-cart', color: '#4A9D5B' },
  { slug: 'carro', name: 'Carro', icon: 'car', color: '#3A6FB0' },
  { slug: 'gasolina', name: 'Gasolina', icon: 'fuel', color: '#CE4436' },
  { slug: 'servicios', name: 'Servicios', icon: 'plug', color: '#7E5BD1' },
  { slug: 'arriendo', name: 'Arriendo', icon: 'home', color: '#2D7FA8' },
  { slug: 'transporte', name: 'Transporte', icon: 'bus', color: '#12A08D' },
  { slug: 'salud', name: 'Salud', icon: 'heart-pulse', color: '#D6497E' },
  { slug: 'entretenimiento', name: 'Entretenimiento', icon: 'clapperboard', color: '#9C4BC4' },
  { slug: 'suscripciones', name: 'Suscripciones', icon: 'repeat', color: '#5A62CE' },
  { slug: 'hogar', name: 'Hogar', icon: 'sofa', color: '#75992F' },
  { slug: 'ropa', name: 'Ropa', icon: 'shirt', color: '#D68B1C' },
  { slug: 'educacion', name: 'Educación', icon: 'graduation-cap', color: '#0E93A8' },
  { slug: 'mascotas', name: 'Mascotas', icon: 'paw-print', color: '#BE4C9C' },
  { slug: 'otros', name: 'Otros', icon: 'circle-dashed', color: '#7A7B72' },
];

export interface MerchantRuleSeed {
  /** Fragmento en mayusculas, tal como queda tras normalizar el comercio. */
  pattern: string;
  categorySlug: string;
}

/**
 * Reglas iniciales para los comercios mas comunes en Colombia.
 * A partir de aqui la app aprende sola: cada confirmacion refuerza una regla.
 */
export const DEFAULT_MERCHANT_RULES: readonly MerchantRuleSeed[] = [
  { pattern: 'RAPPI', categorySlug: 'salidas-comer' },
  { pattern: 'MCDONALDS', categorySlug: 'salidas-comer' },
  { pattern: 'DOMINOS', categorySlug: 'salidas-comer' },
  { pattern: 'JUAN VALDEZ', categorySlug: 'salidas-comer' },
  { pattern: 'STARBUCKS', categorySlug: 'salidas-comer' },
  { pattern: 'CREPES', categorySlug: 'salidas-comer' },
  { pattern: 'EXITO', categorySlug: 'mercado' },
  { pattern: 'CARULLA', categorySlug: 'mercado' },
  { pattern: 'JUMBO', categorySlug: 'mercado' },
  { pattern: 'OLIMPICA', categorySlug: 'mercado' },
  { pattern: 'ARA', categorySlug: 'mercado' },
  { pattern: 'D1', categorySlug: 'mercado' },
  { pattern: 'MAKRO', categorySlug: 'mercado' },
  { pattern: 'TERPEL', categorySlug: 'gasolina' },
  { pattern: 'PRIMAX', categorySlug: 'gasolina' },
  { pattern: 'BIOMAX', categorySlug: 'gasolina' },
  { pattern: 'ESSO', categorySlug: 'gasolina' },
  { pattern: 'UBER', categorySlug: 'transporte' },
  { pattern: 'DIDI', categorySlug: 'transporte' },
  { pattern: 'CABIFY', categorySlug: 'transporte' },
  { pattern: 'NETFLIX', categorySlug: 'suscripciones' },
  { pattern: 'SPOTIFY', categorySlug: 'suscripciones' },
  { pattern: 'DISNEY', categorySlug: 'suscripciones' },
  { pattern: 'CLARO', categorySlug: 'servicios' },
  { pattern: 'MOVISTAR', categorySlug: 'servicios' },
  { pattern: 'TIGO', categorySlug: 'servicios' },
  { pattern: 'EPM', categorySlug: 'servicios' },
  { pattern: 'CODENSA', categorySlug: 'servicios' },
  { pattern: 'ENEL', categorySlug: 'servicios' },
  { pattern: 'VANTI', categorySlug: 'servicios' },
  { pattern: 'CRUZ VERDE', categorySlug: 'salud' },
  { pattern: 'FARMATODO', categorySlug: 'salud' },
  { pattern: 'LOCATEL', categorySlug: 'salud' },
  { pattern: 'FALABELLA', categorySlug: 'ropa' },
  { pattern: 'ZARA', categorySlug: 'ropa' },
  { pattern: 'HOMECENTER', categorySlug: 'hogar' },
];

/** Paquetes Android cuyas notificaciones vale la pena escuchar. */
export const DEFAULT_LISTENED_PACKAGES: readonly string[] = [
  'com.bancolombia.personas',
  'com.todo1.mobile',
  'com.nequi.MobileApp',
  'com.davivienda.daviviendaapp',
  'com.davivienda.daviplataapp',
  'co.com.bbva.bbvanet',
  'com.bancodebogota.bancamovil',
  'com.scotiabankcolpatria.movil',
];
