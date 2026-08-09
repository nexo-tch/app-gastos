/**
 * Puente entre `packages/core` y el prototipo web.
 *
 * Importa modulo por modulo en vez del indice del paquete para no arrastrar
 * zod al navegador: la validacion de esquemas no hace falta aqui y pesa mas
 * que todo el motor junto.
 */
import * as dinero from '../../packages/core/src/money.js';
import * as fechas from '../../packages/core/src/dates.js';
import * as analitica from '../../packages/core/src/analytics.js';
import * as presupuesto from '../../packages/core/src/domain/budget.js';
import * as repartos from '../../packages/core/src/domain/splits.js';
import * as deudas from '../../packages/core/src/domain/debts.js';
import { DEFAULT_CATEGORIES } from '../../packages/core/src/seed.js';

const motor = {
  ...dinero,
  ...fechas,
  ...analitica,
  ...presupuesto,
  ...repartos,
  ...deudas,
  DEFAULT_CATEGORIES,
};

declare global {
  interface Window {
    Motor: typeof motor;
  }
}

window.Motor = motor;
