import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Un esquema, un dialecto. En desarrollo corre sobre PGlite (Postgres
 * compilado a WebAssembly, sin instalar nada) y en produccion sobre Postgres
 * de verdad. Es el mismo SQL en los dos lados, asi que no hay bugs que solo
 * aparezcan al desplegar.
 *
 * Convenciones: la plata siempre en centavos enteros, los meses como texto
 * `YYYY-MM`, y los borrados de gastos son suaves (`deleted_at`) porque el
 * historial es lo unico que no se puede reconstruir.
 */

export const usuarios = pgTable(
  'usuarios',
  {
    id: text('id').primaryKey(),
    /** Siempre en minusculas: el correo no distingue mayusculas para entrar. */
    correo: text('correo').notNull(),
    clave: text('clave').notNull(),
    nombre: text('nombre').notNull(),
    /**
     * Sube en cada escritura confirmada. El navegador manda la revision que
     * cree tener; si no coincide es que otro dispositivo escribio primero, y
     * en vez de pisar los datos en silencio se le pide que recargue.
     */
    revision: integer('revision').notNull().default(0),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ correoIdx: uniqueIndex('usuarios_correo_idx').on(t.correo) }),
);

export const sesiones = pgTable(
  'sesiones',
  {
    /**
     * Se guarda el SHA-256 del token, nunca el token. Asi una fuga de la tabla
     * no entrega llaves usables, igual que con las contrasenas.
     */
    huella: text('huella').primaryKey(),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
    expiraEn: timestamp('expira_en', { withTimezone: true }).notNull(),
  },
  (t) => ({ usuarioIdx: index('sesiones_usuario_idx').on(t.usuarioId) }),
);

/**
 * Cada fila de dominio pertenece a un usuario y se borra con el.
 *
 * La clave primaria es `(usuario_id, id)` y no solo `id`: los identificadores
 * los inventa el navegador, y con clave compuesta es imposible que alguien
 * mande el id de otra persona y termine escribiendo en sus datos.
 */
const dueno = () => ({
  usuarioId: text('usuario_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
});

/** Las listas que el usuario ordena a mano tienen que volver en el mismo orden. */
const orden = { posicion: integer('posicion').notNull().default(0) };

export const cuentas = pgTable(
  'cuentas',
  {
    id: text('id').notNull(),
    ...dueno(),
    nombre: text('nombre').notNull(),
    tipo: text('tipo').notNull(),
    ...orden,
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.id] }) }),
);

export const categorias = pgTable(
  'categorias',
  {
    id: text('id').notNull(),
    ...dueno(),
    nombre: text('nombre').notNull(),
    color: text('color').notNull(),
    /** Guardada, no borrada: sus gastos viejos siguen necesitando el nombre. */
    archivada: boolean('archivada').notNull().default(false),
    ...orden,
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.id] }) }),
);

export const personas = pgTable(
  'personas',
  {
    id: text('id').notNull(),
    ...dueno(),
    nombre: text('nombre').notNull(),
    /** Correo de la cuenta de esa persona en la app, para reconocerla al compartir gastos. */
    correo: text('correo'),
    ...orden,
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.id] }) }),
);

export const gastos = pgTable(
  'gastos',
  {
    id: text('id').notNull(),
    ...dueno(),
    cuentaId: text('cuenta_id'),
    categoriaId: text('categoria_id'),
    estado: text('estado').notNull().default('confirmed'),
    origen: text('origen').notNull().default('manual'),
    montoTotal: integer('monto_total').notNull(),
    miParte: integer('mi_parte').notNull(),
    moneda: text('moneda').notNull().default('COP'),
    /** Tal como se escribio, para leerlo. */
    comercio: text('comercio'),
    /** En mayusculas y sin tildes, para agrupar "Exito" con "EXITO". */
    comercioNormalizado: text('comercio_normalizado'),
    descripcion: text('descripcion'),
    ocurrioEn: timestamp('ocurrio_en', { withTimezone: true }).notNull(),
    confirmadoEn: timestamp('confirmado_en', { withTimezone: true }),
    fijoId: text('fijo_id'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
    borradoEn: timestamp('borrado_en', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.usuarioId, t.id] }),
    fechaIdx: index('gastos_fecha_idx').on(t.usuarioId, t.ocurrioEn),
  }),
);

export const repartos = pgTable(
  'repartos',
  {
    id: text('id').notNull(),
    ...dueno(),
    gastoId: text('gasto_id').notNull(),
    personaId: text('persona_id').notNull(),
    monto: integer('monto').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.usuarioId, t.id] }),
    gastoIdx: index('repartos_gasto_idx').on(t.usuarioId, t.gastoId),
  }),
);

export const abonos = pgTable(
  'abonos',
  {
    id: text('id').notNull(),
    ...dueno(),
    personaId: text('persona_id').notNull(),
    monto: integer('monto').notNull(),
    pagadoEn: timestamp('pagado_en', { withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.id] }) }),
);

/**
 * Lo que yo le debo a alguien: mi parte de un gasto que pago otra persona y
 * que me llego por el enlace que ella comparte.
 *
 * No es un gasto con el reparto al reves. Del gasto de otro no se sabe nada
 * mas que lo que cuente el enlace, y el gasto que se crea en mi cuenta es solo
 * mi parte, para que el presupuesto la cuente. Esta fila es la otra mitad: que
 * esa plata se la debo a alguien.
 */
export const deudas = pgTable(
  'deudas',
  {
    id: text('id').notNull(),
    ...dueno(),
    personaId: text('persona_id').notNull(),
    monto: integer('monto').notNull(),
    descripcion: text('descripcion'),
    ocurrioEn: timestamp('ocurrio_en', { withTimezone: true }).notNull(),
    /** Con fecha, ya se pago. Se paga entera: aqui no hay abonos parciales. */
    pagadaEn: timestamp('pagada_en', { withTimezone: true }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.id] }) }),
);

export const asignaciones = pgTable(
  'asignaciones',
  {
    id: text('id').notNull(),
    ...dueno(),
    abonoId: text('abono_id').notNull(),
    repartoId: text('reparto_id').notNull(),
    monto: integer('monto').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.id] }) }),
);

/**
 * El presupuesto no lleva id propio: hay uno por mes y punto, asi que el mes
 * es la llave. Evita inventar identificadores que nadie mira.
 */
export const presupuestos = pgTable(
  'presupuestos',
  {
    ...dueno(),
    mes: text('mes').notNull(),
    total: integer('total').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.mes] }) }),
);

export const topes = pgTable(
  'topes',
  {
    ...dueno(),
    mes: text('mes').notNull(),
    categoriaId: text('categoria_id').notNull(),
    monto: integer('monto').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.mes, t.categoriaId] }) }),
);

export const fijos = pgTable(
  'fijos',
  {
    id: text('id').notNull(),
    ...dueno(),
    nombre: text('nombre').notNull(),
    categoriaId: text('categoria_id'),
    monto: integer('monto').notNull(),
    diaDelMes: integer('dia_del_mes').notNull().default(1),
    variable: boolean('variable').notNull().default(false),
    archivado: boolean('archivado').notNull().default(false),
    ...orden,
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.id] }) }),
);

/**
 * Un fijo reserva plata desde el dia 1 de cada mes. Esa reserva es una
 * instancia: nace `planned`, y pasa a `posted` cuando se paga o a `skipped`
 * cuando ese mes no toco.
 */
export const instancias = pgTable(
  'instancias',
  {
    id: text('id').notNull(),
    ...dueno(),
    fijoId: text('fijo_id').notNull(),
    mes: text('mes').notNull(),
    montoPlaneado: integer('monto_planeado').notNull(),
    estado: text('estado').notNull().default('planned'),
    gastoId: text('gasto_id'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.usuarioId, t.id] }),
    mesIdx: index('instancias_mes_idx').on(t.usuarioId, t.mes),
  }),
);
