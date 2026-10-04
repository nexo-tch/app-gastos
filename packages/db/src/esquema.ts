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
    avisadoEn: timestamp('avisado_en', { withTimezone: true }),
    aceptadoEn: timestamp('aceptado_en', { withTimezone: true }),
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

/**
 * Avisos in-app cuando alguien con cuenta comparte un gasto contigo.
 * Viven aparte del estado de dominio: son eventos cross-user hacia el receptor.
 */
/**
 * Pasivos financieros globales: tarjetas, créditos, deudas fijas a personas.
 * No entran al presupuesto del mes; el saldo se actualiza con abonos o ajustes manuales.
 */
export const pasivos = pgTable(
  'pasivos',
  {
    id: text('id').notNull(),
    ...dueno(),
    nombre: text('nombre').notNull(),
    tipo: text('tipo').notNull(),
    saldo: integer('saldo').notNull().default(0),
    moneda: text('moneda').notNull().default('COP'),
    cupo: integer('cupo'),
    cuentaId: text('cuenta_id'),
    personaId: text('persona_id'),
    notas: text('notas'),
    ...orden,
  },
  (t) => ({ pk: primaryKey({ columns: [t.usuarioId, t.id] }) }),
);

export const pasivoMovimientos = pgTable(
  'pasivo_movimientos',
  {
    id: text('id').notNull(),
    ...dueno(),
    pasivoId: text('pasivo_id').notNull(),
    tipo: text('tipo').notNull(),
    /** Monto del abono cuando tipo es `payment`. */
    monto: integer('monto'),
    /** Parte del abono que redujo capital (créditos). */
    capital: integer('capital'),
    /** Parte del abono que fue a intereses (créditos). */
    interes: integer('interes'),
    /** Seguro, gastos de cobranza y cargos similares del extracto. */
    cargos: integer('cargos'),
    saldoDespues: integer('saldo_despues').notNull(),
    nota: text('nota'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.usuarioId, t.id] }),
    pasivoIdx: index('pasivo_movimientos_pasivo_idx').on(t.usuarioId, t.pasivoId, t.creadoEn),
  }),
);

export const notificaciones = pgTable(
  'notificaciones',
  {
    id: text('id').notNull(),
    ...dueno(),
    tipo: text('tipo').notNull(),
    repartoId: text('reparto_id').notNull(),
    emisorCorreo: text('emisor_correo').notNull(),
    emisorNombre: text('emisor_nombre'),
    /** Mismo JSON que viaja en el enlace #compartido, para abrir el flujo recibido. */
    carga: text('carga').notNull(),
    leidaEn: timestamp('leida_en', { withTimezone: true }),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.usuarioId, t.id] }),
    pendientesIdx: index('notificaciones_pendientes_idx').on(t.usuarioId, t.creadaEn),
  }),
);

/* ── Viajes en grupo ───────────────────────────────────────────────
 *
 * Lo unico de la base que no es de un solo usuario. Un viaje lo comparten
 * varias cuentas: cada una carga sus gastos y todas ven los de todas. Por eso
 * no cuelga de `usuario_id` ni viaja dentro de `/api/estado`, sino que tiene
 * sus propios endpoints, que miran en cada peticion que quien pide sea
 * miembro del viaje.
 */

export const viajes = pgTable(
  'viajes',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    /** En la que se suman los saldos. No cambia despues de crear el viaje. */
    monedaBase: text('moneda_base').notNull(),
    /**
     * JSON `{ "EUR": 4500 }`: cuantas unidades de la moneda base vale una de
     * cada otra. Es una tasa fija que acuerda el grupo, no la del dia.
     */
    tasas: text('tasas').notNull().default('{}'),
    /** Lo que va en el enlace de invitacion. Quien lo tenga puede unirse. */
    codigo: text('codigo').notNull(),
    creadoPor: text('creado_por')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ codigoIdx: uniqueIndex('viajes_codigo_idx').on(t.codigo) }),
);

const delViaje = () => ({
  viajeId: text('viaje_id')
    .notNull()
    .references(() => viajes.id, { onDelete: 'cascade' }),
});

export const viajeMiembros = pgTable(
  'viaje_miembros',
  {
    ...delViaje(),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    unidoEn: timestamp('unido_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.viajeId, t.usuarioId] }),
    usuarioIdx: index('viaje_miembros_usuario_idx').on(t.usuarioId),
  }),
);

export const viajeGastos = pgTable(
  'viaje_gastos',
  {
    id: text('id').notNull(),
    ...delViaje(),
    /** Solo quien lo creo puede cambiarlo o borrarlo. */
    creadoPor: text('creado_por').notNull(),
    descripcion: text('descripcion').notNull(),
    categoria: text('categoria').notNull(),
    moneda: text('moneda').notNull(),
    montoTotal: integer('monto_total').notNull(),
    /** `equal`, `amounts` o `percent`: como se repartio, para poder editarlo igual. */
    modo: text('modo').notNull(),
    ocurrioEn: timestamp('ocurrio_en', { withTimezone: true }).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.viajeId, t.id] }) }),
);

/**
 * Una fila por miembro que pago, consumio o las dos cosas en un gasto. Lo
 * pagado y lo consumido ya van resueltos al centavo; `peso` guarda lo que se
 * escribio (centesimas de porcentaje, o el monto) para volver a editarlo.
 */
export const viajePartes = pgTable(
  'viaje_partes',
  {
    ...delViaje(),
    gastoId: text('gasto_id').notNull(),
    usuarioId: text('usuario_id').notNull(),
    pagado: integer('pagado').notNull().default(0),
    debe: integer('debe').notNull().default(0),
    participa: boolean('participa').notNull().default(false),
    peso: integer('peso'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.viajeId, t.gastoId, t.usuarioId] }) }),
);

/** Plata que un miembro le paso a otro para saldar, en la moneda base. */
export const viajePagos = pgTable(
  'viaje_pagos',
  {
    id: text('id').notNull(),
    ...delViaje(),
    de: text('de').notNull(),
    a: text('a').notNull(),
    monto: integer('monto').notNull(),
    registradoPor: text('registrado_por').notNull(),
    ocurrioEn: timestamp('ocurrio_en', { withTimezone: true }).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.viajeId, t.id] }) }),
);
