# Gastos

Aplicación web de gastos personales, pensada para usarse desde el teléfono. Cada persona tiene su cuenta con correo y contraseña, y sus datos son suyos: nadie más los ve. Se instala en la pantalla de inicio como una app y funciona sin señal, porque el navegador guarda una copia de todo y sube los cambios cuando vuelve la conexión.

Responde tres preguntas, en este orden de importancia:

1. **¿Cuánto me queda este mes?** Descontando ya los gastos fijos que todavía no has pagado, para que la cifra no mienta.
2. **¿En qué se me va?** Por categoría, con topes opcionales y aviso cuando el ritmo no da.
3. **¿Quién me debe?** Repartes un gasto con quien quieras y la app lleva la cuenta hasta que te paguen.

## Cómo está armado

```
Navegador                               Servidor
┌─────────────────────────┐             ┌──────────────────────┐
│  app.js  (la interfaz)  │             │  Next route handlers │
│      ↓ mutar()          │             │      ↓ cookie        │
│  almacen ───────────────┼── PUT ─────▶│  sesión → usuario    │
│      ↓                  │  solo lo    │      ↓               │
│  localStorage (copia)   │◀── GET ─────│  Drizzle → Postgres  │
└─────────────────────────┘  que cambió └──────────────────────┘
```

Toda la interfaz escribe a través de una función, `mutar()`, y toda la persistencia pasa por un objeto, `almacen`. Por eso la app pudo pasar de vivir solo en el navegador a tener cuentas en Postgres sin tocar ninguna de las treinta operaciones de negocio: cambió un objeto.

El navegador manda **solo las filas que cambiaron**, comparando contra la última copia que el servidor confirmó. Cada cuenta lleva un número de revisión; si dos dispositivos escriben a la vez, el segundo recibe un conflicto y recarga en lugar de pisar datos en silencio.

| Paquete | Qué contiene |
| --- | --- |
| `packages/core` | TypeScript puro, sin React ni SQL: motor de presupuesto, reparto de gastos, deudas y liquidaciones, fechas y dinero. **Aquí está el valor de la app** y todo está probado. |
| `packages/db` | El esquema de Postgres en Drizzle y sus migraciones. Un solo esquema para los dos entornos. |
| `apps/web` | Next.js: autenticación, el endpoint de estado y el servidor de la app. |
| `prototipo` | Las fuentes de la interfaz. `construir.mjs` las convierte en el HTML que sirve `apps/web` y en un archivo suelto que se abre con doble clic. |

Dos reglas del modelo de datos que no se negocian:

1. **El dinero siempre es un entero en centavos.** Nunca un `float`.
2. **Cada gasto tiene dos montos.** `amount_total_cents` es lo que costó; `my_share_cents` es lo que consume tu presupuesto. Mezclarlos es el error que arruina las apps de gastos compartidos.

## Empezar

```bash
npm install
npm run dev
```

Y ya está: `http://localhost:3000` pide crear una cuenta y entra. **No hace falta instalar Postgres.** Sin `GASTOS_DATABASE_DATABASE_URL`, la app levanta [PGlite](https://pglite.dev), que es Postgres compilado a WebAssembly, y guarda la base en `.datos/dev`. Las migraciones se aplican solas al arrancar.

Es Postgres de verdad en los dos lados, y esa es la gracia: un solo esquema, un solo SQL y un solo juego de migraciones. Con SQLite en desarrollo habría dos de cada, y bugs que solo aparecen al desplegar.

### Variables de entorno

Ninguna es obligatoria en desarrollo. Están documentadas en `apps/web/.env.example`.

| Variable | Para qué |
| --- | --- |
| `GASTOS_DATABASE_DATABASE_URL` | El Postgres de producción. Si está, se usa; si no, PGlite. Es la cadena del *pooler*, y el nombre lo escribe la integración de Neon con Vercel: pega `_DATABASE_URL` detrás del prefijo de la conexión, que aquí es `GASTOS_DATABASE`. Se lee tal cual para no tener dos variables con la misma cadena. |
| `PGLITE_DIR` | Dónde guarda PGlite en desarrollo. Por defecto `.datos/dev`. |

### Comprobar que todo está bien

```bash
npm run test        # el motor financiero y los endpoints contra PGlite
npm run typecheck
```

## El prototipo, y por qué sigue existiendo

La interfaz no es React: son HTML, CSS y JavaScript sin marco, en `prototipo/src`. `construir.mjs` los empaqueta junto con el motor de `packages/core` y produce dos cosas del mismo código:

- `apps/web/public/` — lo que sirve Next: la app, la pantalla de entrada, el manifiesto, los iconos y el service worker.
- `prototipo/gastos.html` — un archivo suelto que se abre con doble clic, sin servidor y sin cuenta, guardando todo en el navegador.

La app nota sola dónde está: si no hay servidor detrás, trabaja sin cuenta.

```bash
npm run prototipo          # compila
npm run prototipo:probar   # recorre los flujos de todos los días en un DOM simulado
npm run prototipo:ver      # lo sirve con datos de ejemplo ya cargados
```

La vista previa acepta parámetros para dejar la pantalla lista antes de fotografiarla: `?vista=personas`, `?abrir=gasto`, `?tope=1200000` para forzar un mes apretado, `?tema=oscuro` para ver el tema oscuro sin cambiar el sistema operativo, y `?medir=1` para delatar cualquier elemento que se salga del ancho.

## Los dos temas

Todos los colores son fichas semánticas (`--fondo`, `--texto`, `--marca`) declaradas una sola vez en `:root`, y el tema oscuro solo las reescribe dentro de su *media query*. Ninguna otra regla nombra un color directo, así que los dos temas no se pueden desincronizar.

El color solo aparece cuando dice algo. Verde, ámbar y rojo son estados del presupuesto; el verde jade es la marca y lo que se puede tocar. La única decoración son los colores de las categorías, y esos los elige el usuario.

## Presupuesto y gastos fijos no son lo mismo

Es la distinción que más confunde, y la app la sostiene en todas partes:

- Un **gasto fijo** es el que llega solo cada mes: arriendo, cuotas, servicios. Se descuenta desde el día 1 aunque no lo hayas pagado, para que el disponible nunca te mienta. Cuando lo pagas, la reserva se convierte en gasto: no se cuenta dos veces.
- Un **tope de categoría** es para lo que decides cada vez: mercado, gasolina, salidas. No reserva nada, solo vigila.

La gasolina es un tope, no un fijo: nadie te la cobra sola.

## Cómo entra la plata a la base

Cada cuenta tiene sus propias filas y todas cuelgan de `usuario_id` con borrado en cascada. La clave primaria de cada tabla es `(usuario_id, id)` y no solo `id`: como los identificadores los inventa el navegador, con clave compuesta es imposible que alguien mande el id de otra persona y termine escribiendo en sus datos.

Las contraseñas van con `scrypt` de la librería estándar de Node —sin binarios nativos que compilar— y de la sesión solo se guarda el SHA-256 de su token, para que la tabla `sesiones` no sea una lista de llaves usables.

## Lo que hay que aceptar

- **Un dispositivo escribiendo a la vez.** Con el número de revisión, si abres la app en dos sitios el segundo recarga en vez de pisar. Para uso personal sobra; si algún día hiciera falta edición simultánea real, el camino son endpoints por operación, y como todo pasa por `mutar()`, la interfaz no se enteraría.
- **La cáscara HTML es pública.** Los datos exigen sesión, pero el archivo con el código de la app no es secreto. Es lo normal en cualquier aplicación web.
