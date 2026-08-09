import { describe, expect, it } from 'vitest';

import { enrichPersonEmail, matchPersonForSharedExpense } from './personLink.js';

describe('matchPersonForSharedExpense', () => {
  const personas = [
    { id: 'p1', name: 'edxa', email: 'ed@ejemplo.com' },
    { id: 'p2', name: 'Ana', email: null },
  ];

  it('prefiere el correo de la cuenta aunque el nombre no coincida', () => {
    expect(
      matchPersonForSharedExpense(personas, { correo: 'ed@ejemplo.com', nombre: 'Ed' }),
    ).toEqual(personas[0]);
  });

  it('cae al nombre si no hay correo en el enlace', () => {
    expect(matchPersonForSharedExpense(personas, { nombre: 'Ana' })).toEqual(personas[1]);
  });

  it('devuelve null si no hay coincidencia', () => {
    expect(matchPersonForSharedExpense(personas, { correo: 'otro@ejemplo.com', nombre: 'Ed' })).toBeNull();
  });
});

describe('enrichPersonEmail', () => {
  it('no pisa un correo que ya tenia', () => {
    expect(enrichPersonEmail({ id: 'p1', name: 'Ed', email: 'viejo@ejemplo.com' }, 'nuevo@ejemplo.com')).toEqual({
      id: 'p1',
      name: 'Ed',
      email: 'viejo@ejemplo.com',
    });
  });

  it('guarda el correo del remitente si faltaba', () => {
    expect(enrichPersonEmail({ id: 'p1', name: 'edxa', email: null }, 'Ed@Ejemplo.com')).toEqual({
      id: 'p1',
      name: 'edxa',
      email: 'ed@ejemplo.com',
    });
  });
});
