import { DEFAULT_CATEGORIES } from '@gastos/core';
import { esquema } from '@gastos/db';

/**
 * Lo que ve alguien la primera vez que entra. Una pantalla en blanco con
 * quince categorias por crear no invita a registrar nada, asi que la cuenta
 * nace con las categorias del motor y las tres formas de pagar de siempre.
 */
export function filasIniciales(usuarioId: string): {
  cuentas: (typeof esquema.cuentas.$inferInsert)[];
  categorias: (typeof esquema.categorias.$inferInsert)[];
} {
  return {
    cuentas: [
      { id: 'efectivo', usuarioId, nombre: 'Efectivo', tipo: 'cash', posicion: 0 },
      { id: 'debito', usuarioId, nombre: 'Débito', tipo: 'debit', posicion: 1 },
      { id: 'credito', usuarioId, nombre: 'Tarjeta de crédito', tipo: 'credit', posicion: 2 },
    ],
    categorias: DEFAULT_CATEGORIES.map((categoria, posicion) => ({
      id: categoria.slug,
      usuarioId,
      nombre: categoria.name,
      color: categoria.color,
      archivada: false,
      posicion,
    })),
  };
}
