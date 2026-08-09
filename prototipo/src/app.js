/* eslint-disable */
(function () {
  'use strict';

  const M = window.Motor;
  const OFFSET = '-05:00';
  const CLAVE = 'gastos.prototipo.v1';

  /**
   * Los colores que se ofrecen al crear una categoría son exactamente los que
   * el motor trae de fábrica, leídos de ahí y no copiados: una paleta duplicada
   * es una paleta que se desincroniza.
   */
  const PALETA = [...new Set(M.DEFAULT_CATEGORIES.map((c) => c.color))];

  /* ══ Almacenamiento ══════════════════════════════════════════════
   * Toda lectura y escritura pasa por aqui, y el resto de la aplicacion no se
   * entera de donde viven los datos.
   *
   * El navegador es siempre la copia rapida: la app abre con lo que ya tiene
   * y despues se pone al dia con el servidor, porque nadie deberia mirar un
   * spinner para saber cuanta plata le queda. Al servidor no se le manda el
   * estado entero en cada tecla, solo las filas que cambiaron.
   *
   * Sin servidor detras (el archivo abierto con doble clic, o las pruebas)
   * funciona igual de bien, solo que sin cuenta y sin sincronizar.
   */

  const almacen = (() => {
    const cache = {
      leer() {
        try {
          const crudo = localStorage.getItem(CLAVE);
          return crudo ? JSON.parse(crudo) : null;
        } catch (error) {
          console.warn('No se pudo leer lo guardado', error);
          return null;
        }
      },
      escribir(estado) {
        try {
          localStorage.setItem(CLAVE, JSON.stringify(estado));
        } catch {
          avisar('Este navegador no deja guardar. Puede estar lleno o en modo privado.');
        }
      },
      borrar() {
        try {
          localStorage.removeItem(CLAVE);
        } catch {
          /* si no se puede borrar, tampoco hay nada que hacer */
        }
      },
    };

    const conCuenta =
      typeof fetch === 'function' && !window.SIN_SERVIDOR && location.protocol !== 'file:';

    /** Las listas que el usuario ve en orden tienen que volver en ese orden. */
    const COLECCIONES = [
      { nombre: 'cuentas', ordenada: true },
      { nombre: 'categorias', ordenada: true },
      { nombre: 'personas', ordenada: true },
      { nombre: 'gastos', ordenada: false },
      { nombre: 'repartos', ordenada: false },
      { nombre: 'abonos', ordenada: false },
      { nombre: 'asignaciones', ordenada: false },
      { nombre: 'deudas', ordenada: false },
      { nombre: 'fijos', ordenada: true },
      { nombre: 'instancias', ordenada: false },
    ];

    let revision = 0;
    let confirmado = null;
    let temporizador = null;
    let enviando = false;
    let quejado = false;
    let cuenta = null;
    let alRecibir = () => {};
    let firmaAlEstrenar = null;
    let intentosEstrenar = 0;

    const fetchCuenta = (url, init = {}) =>
      fetch(url, { credentials: 'same-origin', ...init });

    /**
     * Dos filas son la misma si dicen lo mismo, aunque no lo digan igual.
     *
     * Hace falta porque el servidor devuelve las fechas en UTC y con las
     * claves en otro orden que el navegador, y los campos vacios a veces
     * llegan como null y a veces no llegan. Sin normalizar eso, cada guardado
     * creeria que cambio todo y volveria a subir el historial entero.
     */
    const firma = (valor) =>
      JSON.stringify(valor, (clave, dato) => {
        if (typeof dato === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(dato)) {
          const fecha = new Date(dato);
          return Number.isNaN(fecha.getTime()) ? dato : fecha.toISOString();
        }
        if (dato && typeof dato === 'object' && !Array.isArray(dato)) {
          const ordenado = {};
          for (const nombre of Object.keys(dato).sort()) {
            if (dato[nombre] !== null && dato[nombre] !== undefined) ordenado[nombre] = dato[nombre];
          }
          return ordenado;
        }
        return dato;
      });

    const diferencia = (antes, ahora, ordenada) => {
      const previos = new Map((antes ?? []).map((fila) => [fila.id, fila]));
      const puestos = [];

      (ahora ?? []).forEach((fila, indice) => {
        const viejo = previos.get(fila.id);
        previos.delete(fila.id);
        if (viejo && firma(viejo) === firma(fila)) return;
        puestos.push(ordenada ? { ...fila, posicion: indice } : fila);
      });

      return { puestos, quitados: [...previos.keys()] };
    };

    /** El presupuesto no es una lista sino un objeto por mes, y se compara asi. */
    const diferenciaPresupuestos = (antes, ahora) => {
      const previos = antes ?? {};
      const actuales = ahora ?? {};

      const puestos = Object.entries(actuales)
        .filter(([mes, valor]) => firma(previos[mes]) !== firma(valor))
        .map(([mes, valor]) => ({
          mes,
          totalCents: valor.totalCents ?? 0,
          limites: valor.limites ?? {},
        }));

      return { puestos, quitados: Object.keys(previos).filter((mes) => !(mes in actuales)) };
    };

    const calcularCambios = (estado) => {
      const cambios = { presupuestos: diferenciaPresupuestos(confirmado?.presupuestos, estado.presupuestos) };
      for (const { nombre, ordenada } of COLECCIONES) {
        cambios[nombre] = diferencia(confirmado?.[nombre], estado[nombre], ordenada);
      }
      return cambios;
    };

    const hayAlgoQueMandar = (cambios) =>
      Object.values(cambios).some((c) => c.puestos.length > 0 || c.quitados.length > 0);

    const adoptar = (estado, revisionServidor) => {
      revision = revisionServidor;
      const copia = JSON.parse(JSON.stringify(estado));
      confirmado = JSON.parse(JSON.stringify(copia));
      cache.escribir(copia);
      alRecibir(copia);
    };

    /** El estado que se esta pintando ahora mismo, para poder reintentar. */
    let vigente = null;

    async function empujar({ ultimoAliento = false } = {}) {
      if (!conCuenta || enviando || !vigente || !confirmado) return;

      const cambios = calcularCambios(vigente);
      if (!hayAlgoQueMandar(cambios)) return;

      const instantanea = vigente;
      enviando = true;

      try {
        const respuesta = await fetchCuenta('/api/estado', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision, cambios }),
          keepalive: ultimoAliento,
        });

        if (respuesta.status === 401) {
          location.href = '/entrar';
          return;
        }

        if (respuesta.status === 409) {
          // Otro dispositivo escribio primero. Se toma lo del servidor en vez
          // de pisarlo: perder un cambio a ciegas es peor que rehacerlo.
          const cuerpo = await respuesta.json();
          adoptar(cuerpo.datos, cuerpo.revision);
          avisar('Otro dispositivo tenia cambios más nuevos. Recargué lo que hay en tu cuenta.');
          return;
        }

        if (respuesta.status === 400) {
          console.error('El servidor rechazó los cambios', await respuesta.text());
          avisar('No pude guardar en tu cuenta. Revisa la conexión e inténtalo de nuevo.');
          programar(8000);
          return;
        }

        if (!respuesta.ok) throw new Error(`El servidor respondio ${respuesta.status}`);

        const cuerpo = await respuesta.json();
        revision = cuerpo.revision;
        confirmado = JSON.parse(JSON.stringify(instantanea));
        if (quejado) {
          quejado = false;
          avisar('Volvió la conexión: ya está todo guardado en tu cuenta.');
        }
      } catch (error) {
        // No se toca `confirmado`: en el proximo intento el delta vuelve a
        // incluir esto y lo que haya pasado mientras tanto.
        console.warn('No se pudo sincronizar', error);
        if (!quejado) {
          quejado = true;
          avisar('Sin conexión. Lo guardo aquí y lo subo cuando vuelva.');
        }
        programar(8000);
      } finally {
        enviando = false;
      }
    }

    /** Sube de una vez la copia local cuando la cuenta en el servidor está vacía. */
    async function subirCompleto(estado) {
      if (!conCuenta || enviando) return false;

      enviando = true;
      try {
        const respuesta = await fetchCuenta('/api/estado/completo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision, datos: estado }),
        });

        if (respuesta.status === 401) {
          location.href = '/entrar';
          return false;
        }

        if (!respuesta.ok) throw new Error(`El servidor respondio ${respuesta.status}`);

        const cuerpo = await respuesta.json();
        revision = cuerpo.revision;
        adoptar(cuerpo.datos ?? estado, revision);
        if (quejado) quejado = false;
        avisar('Todo guardado en tu cuenta.');
        return true;
      } catch (error) {
        console.warn('No se pudo subir la copia local', error);
        if (!quejado) {
          quejado = true;
          avisar('Sin conexión. Lo guardo aquí y lo subo cuando vuelva.');
        }
        programar(8000);
        return false;
      } finally {
        enviando = false;
      }
    }

    function programar(espera = 700) {
      if (!conCuenta) return;
      clearTimeout(temporizador);
      temporizador = setTimeout(() => empujar(), espera);
    }

    /**
       * Trae la cuenta del servidor. Si la cuenta esta vacia y este navegador
       * tiene datos de antes, los sube solos en vez de tirarlos.
       */
    async function estrenar(estadoLocal) {
      vigente = estadoLocal;
      if (!conCuenta) return;

      firmaAlEstrenar = firma(estadoLocal);

      let cuerpo;
      try {
        const respuesta = await fetchCuenta('/api/estado', { headers: { accept: 'application/json' } });
        if (respuesta.status === 401) {
          location.href = '/entrar';
          return;
        }
        if (!respuesta.ok) throw new Error(`El servidor respondio ${respuesta.status}`);
        cuerpo = await respuesta.json();
        intentosEstrenar = 0;
      } catch (error) {
        console.warn('No se pudo leer la cuenta', error);
        quejado = true;
        avisar('Sin conexión con tu cuenta. Trabajo con lo que hay en este navegador.');
        const espera = Math.min(30_000, 2000 * 2 ** intentosEstrenar++);
        setTimeout(() => estrenar(vigente ?? estadoLocal), espera);
        return;
      }

      cuenta = { nombre: cuerpo.nombre ?? '', correo: cuerpo.correo ?? '' };
      revision = cuerpo.revision;
      confirmado = JSON.parse(JSON.stringify(cuerpo.datos));

      const cuentaVacia =
        cuerpo.datos.gastos.length === 0 &&
        cuerpo.datos.personas.length === 0 &&
        cuerpo.datos.fijos.length === 0;
      const aquiHayAlgo =
        estadoLocal &&
        (estadoLocal.gastos?.length > 0 ||
          estadoLocal.personas?.length > 0 ||
          estadoLocal.fijos?.length > 0);

      if (cuentaVacia && aquiHayAlgo) {
        avisar('Subiendo lo que tenías en este navegador…');
        await subirCompleto(vigente);
        return;
      }

      // Si alguien registro algo mientras llegaba la cuenta, no se pisa con lo
      // del servidor: se sube el delta y la pantalla se queda como esta.
      if (firma(vigente) !== firmaAlEstrenar) {
        programar(0);
        return;
      }

      adoptar(cuerpo.datos, cuerpo.revision);
    }

    if (conCuenta) {
      // Cerrar la pestaña con algo sin subir es la forma mas facil de perder
      // un gasto. `keepalive` deja que el envio sobreviva a la pagina.
      addEventListener('pagehide', () => {
        clearTimeout(temporizador);
        empujar({ ultimoAliento: true });
      });
      addEventListener('online', () => {
        if (!confirmado && vigente) estrenar(vigente);
        else programar(0);
      });
    }

    return {
      conCuenta,

      /** Lo que hay en este navegador, que es con lo que se pinta al abrir. */
      inicial() {
        return cache.leer();
      },

      /** Quien tiene la sesion abierta, o null si se esta trabajando sin cuenta. */
      quienSoy() {
        return cuenta;
      },

      escuchar(fn) {
        alRecibir = fn;
      },

      guardar(estado) {
        vigente = estado;
        cache.escribir(estado);
        programar();
      },

      limpiar() {
        cache.borrar();
      },

      estrenar,
    };
  })();

  /* ══ Utilidades ══════════════════════════════════════════════════ */

  const id = () => Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);
  const ahora = () => new Date().toISOString();
  const plata = (centavos) => M.formatMoney(centavos, { currency: 'COP' });
  const normalizarCorreo = (correo) => String(correo ?? '').trim().toLowerCase();

  const escapar = (texto) =>
    String(texto ?? '').replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });

  /** El teclado solo entrega digitos; el peso colombiano no usa centavos. */
  const centavosDesdeTexto = (texto) => {
    const digitos = String(texto ?? '').replace(/\D/g, '');
    if (!digitos) return 0;
    return Number(digitos) * 100;
  };

  const textoDesdeCentavos = (centavos) => {
    if (!centavos) return '';
    return new Intl.NumberFormat('es-CO').format(Math.round(centavos / 100));
  };

  const isoDeDia = (dia) => `${dia}T12:00:00${OFFSET}`;
  const diaDeIso = (iso) => M.dayKeyOf(iso, OFFSET);
  const hoyDia = () => M.dayKeyOf(new Date(), OFFSET);

  const conMayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

  const nombreMes = (mes) => {
    const { year, month } = M.splitMonthKey(mes);
    return conMayuscula(
      new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(
        new Date(Date.UTC(year, month - 1, 15)),
      ),
    );
  };

  const nombreDia = (dia) => {
    const [a, m, d] = dia.split('-').map(Number);
    const fecha = new Date(Date.UTC(a, m - 1, d));
    if (dia === hoyDia()) return 'Hoy';
    return conMayuscula(
      new Intl.DateTimeFormat('es-CO', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      }).format(fecha),
    );
  };

  const fechaAvisoCorta = (iso) => {
    const dia = diaDeIso(iso);
    if (dia === hoyDia()) return 'hoy';
    const [a, m, d] = dia.split('-').map(Number);
    const fecha = new Date(Date.UTC(a, m - 1, d));
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(fecha);
  };

  const iniciales = (nombre) =>
    String(nombre)
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();

  function avisar(mensaje) {
    const caja = document.getElementById('avisos');
    const nodo = document.createElement('div');
    nodo.className = 'aviso';
    nodo.textContent = mensaje;
    caja.appendChild(nodo);
    setTimeout(() => nodo.remove(), 2600);
  }

  /* ══ Estado ══════════════════════════════════════════════════════ */

  const vacio = () => ({
    version: 1,
    cuentas: [
      { id: 'efectivo', name: 'Efectivo', kind: 'cash' },
      { id: 'debito', name: 'Débito', kind: 'debit' },
      { id: 'credito', name: 'Tarjeta de crédito', kind: 'credit' },
    ],
    categorias: M.DEFAULT_CATEGORIES.map((c) => ({
      id: c.slug,
      name: c.name,
      color: c.color,
      isArchived: false,
    })),
    personas: [],
    gastos: [],
    repartos: [],
    abonos: [],
    asignaciones: [],
    deudas: [],
    presupuestos: {},
    fijos: [],
    instancias: [],
  });

  /**
   * Un estado guardado por una versión anterior de la app no trae las listas
   * que se agregaron después, y una lista que no existe rompe la primera
   * pantalla. Pasa con la copia del navegador y con los archivos exportados.
   */
  function completar(estado) {
    const plantilla = vacio();
    for (const [nombre, valor] of Object.entries(plantilla)) {
      if (Array.isArray(valor) && !Array.isArray(estado[nombre])) estado[nombre] = valor;
    }
    estado.presupuestos ??= {};
    return estado;
  }

  let datos = completar(almacen.inicial() ?? vacio());
  let mes = M.monthKeyOf(new Date(), OFFSET);
  let vista = 'resumen';
  let agregandoPersona = false;
  let correoPersonaEditando = null;

  /** Unico punto de escritura: aplica el cambio, persiste y redibuja. */
  function mutar(cambio) {
    cambio(datos);
    almacen.guardar(datos);
    pintar();
  }

  const categoriaPorId = (idCat) => datos.categorias.find((c) => c.id === idCat) ?? null;

  /**
   * Una categoría guardada desaparece de los selectores pero sigue existiendo:
   * los gastos viejos tienen que poder decir a qué pertenecían.
   */
  const categoriasActivas = () => datos.categorias.filter((c) => !c.isArchived);

  const categoriaEnUso = (idCat) =>
    datos.gastos.some((g) => !g.deletedAt && g.categoryId === idCat) ||
    datos.fijos.some((f) => !f.isArchived && f.categoryId === idCat);

  const personaPorId = (idPer) => datos.personas.find((p) => p.id === idPer) ?? null;
  const cuentaPorId = (idCta) => datos.cuentas.find((c) => c.id === idCta) ?? null;

  const nombreCategoria = (idCat) => categoriaPorId(idCat)?.name ?? 'Sin categoría';

  /**
   * El motor devuelve el comercio normalizado, que va en mayúsculas porque sirve
   * para cruzar notificaciones. Para leer conviene el nombre tal como se escribió.
   */
  const nombreDelGasto = (idGasto, respaldo) => {
    const gasto = datos.gastos.find((g) => g.id === idGasto);
    return gasto?.merchantRaw || gasto?.description || respaldo || 'Gasto';
  };
  const colorCategoria = (idCat) => categoriaPorId(idCat)?.color ?? '#8B9098';

  const gastosVivos = () => datos.gastos.filter((g) => !g.deletedAt);
  const repartosDe = (idGasto) => datos.repartos.filter((r) => r.expenseId === idGasto);

  const presupuestoDe = (clave) => datos.presupuestos[clave] ?? { totalCents: 0, limites: {} };

  /* ══ Gastos fijos: instancias del mes ════════════════════════════
   * Un fijo reserva presupuesto desde el dia 1. Al abrir un mes se crean las
   * instancias que falten, en estado `planned`, para que el motor las descuente
   * aunque todavia no se hayan pagado.
   */

  function asegurarInstancias(clave) {
    // Un mes que ya pasó no puede reservar nada: lo que no se pagó, no se pagó.
    if (clave < M.monthKeyOf(new Date(), OFFSET)) return;

    let creadas = 0;
    for (const fijo of datos.fijos) {
      if (fijo.isArchived) continue;
      const existe = datos.instancias.some((i) => i.recurringId === fijo.id && i.month === clave);
      if (existe) continue;
      datos.instancias.push({
        id: id(),
        recurringId: fijo.id,
        month: clave,
        plannedCents: fijo.amountCents,
        status: 'planned',
        expenseId: null,
      });
      creadas += 1;
    }
    if (creadas > 0) almacen.guardar(datos);
  }

  const instanciasDelMes = (clave) => {
    const activos = new Set(datos.fijos.filter((f) => !f.isArchived).map((f) => f.id));
    return datos.instancias.filter((i) => i.month === clave && activos.has(i.recurringId));
  };

  /** Lo que el motor necesita saber de los fijos para reservar presupuesto. */
  function compromisos(clave) {
    return instanciasDelMes(clave).map((i) => {
      const fijo = datos.fijos.find((f) => f.id === i.recurringId);
      return {
        id: i.id,
        month: i.month,
        categoryId: fijo?.categoryId ?? null,
        plannedCents: i.plannedCents,
        status: i.status,
      };
    });
  }

  /* ══ Cálculo del mes ═════════════════════════════════════════════ */

  function resumenDelMes(clave) {
    const presu = presupuestoDe(clave);
    // Un tope de una categoría guardada no debe seguir vigilando nada, pero el
    // número se conserva por si la restauras.
    const limites = Object.entries(presu.limites ?? {})
      .filter(([idCat, centavos]) => centavos > 0 && !categoriaPorId(idCat)?.isArchived)
      .map(([categoryId, limitCents]) => ({ categoryId, limitCents }));

    return M.computeBudgetSummary({
      month: clave,
      totalBudgetCents: presu.totalCents > 0 ? presu.totalCents : null,
      categoryLimits: limites,
      expenses: gastosVivos(),
      commitments: compromisos(clave),
      now: new Date(),
      utcOffset: OFFSET,
    });
  }

  /** Lo que me deben, que sale de mis gastos y de cómo los repartí. */
  const porCobrar = () =>
    M.computeDebts({
      expenses: gastosVivos(),
      splits: datos.repartos,
      settlements: datos.abonos,
      allocations: datos.asignaciones,
    });

  /** Lo que yo debo, que llegó compartido y no sale de ningún gasto mío. */
  const porPagar = () => M.computeOwed(datos.deudas);

  /* ══ Tablero: la barra del mes ═══════════════════════════════════ */

  function pintarTablero(resumen) {
    const caja = document.getElementById('tablero-caja');
    const esMesActual = mes === M.monthKeyOf(new Date(), OFFSET);
    const debo = porPagar();

    // El estado tiñe la tarjeta entera: verde mientras todo va bien, ámbar
    // cuando aprieta y rojo cuando ya no alcanza. Es la señal que se lee de
    // lejos, antes de leer un solo número.
    document.getElementById('tablero').dataset.estado = resumen.hasBudget ? resumen.state : 'ok';

    const base = Math.max(
      resumen.budgetedCents,
      resumen.spentCents + resumen.committedCents,
      1,
    );
    const anchoGastado = Math.min((resumen.spentCents / base) * 100, 100);
    const anchoFijos = Math.min((resumen.committedCents / base) * 100, 100 - anchoGastado);
    const posicionHoy = (resumen.daysElapsed / resumen.daysInMonth) * 100;

    const libre = Math.max(resumen.availableCents, 0);

    const contexto = resumen.hasBudget
      ? `de <strong>${plata(resumen.budgetedCents)}</strong> presupuestados` +
        (resumen.daysRemaining > 0
          ? ` · quedan ${resumen.daysRemaining} día${resumen.daysRemaining === 1 ? '' : 's'}` +
            ` · <strong>${plata(resumen.safeDailyCents)}</strong> al día`
          : ' · mes cerrado')
      : 'Sin presupuesto todavía. Di con cuánta plata cuentas este mes para saber cuánto te queda.';

    // Quedarse corto por haber gastado de más y quedarse corto porque los fijos
    // no caben son dos problemas distintos, y se arreglan de forma distinta.
    const gasteDeMas = resumen.spentCents > resumen.budgetedCents;
    const fijosNoCaben = resumen.hasBudget && resumen.availableCents < 0 && !gasteDeMas;

    const titular = !resumen.hasBudget
      ? 'Llevas gastado'
      : gasteDeMas
        ? 'Te pasaste por'
        : fijosNoCaben
          ? 'Te faltan para los fijos'
          : 'Te queda para el mes';

    const monto = resumen.hasBudget ? Math.abs(resumen.availableCents) : resumen.spentCents;

    const noCaben = fijosNoCaben
      ? `<p class="pista" style="margin-top:10px">Todavía no has gastado de más: son los fijos por
           pagar (<b class="cifra">${plata(resumen.committedCents)}</b>) los que no caben en los
           <b class="cifra">${plata(resumen.budgetedCents)}</b> del mes. Sube esa cifra si te entra
           más plata, o ajusta algún fijo: así como está, no queda nada para el día a día.</p>`
      : '';

    const proyeccion =
      !fijosNoCaben && resumen.hasBudget && resumen.isProjectedToExceed && resumen.daysRemaining > 0
        ? `<p class="pista" style="margin-top:10px">A este ritmo terminas el mes en
             <b class="cifra">${plata(resumen.projectedEndOfMonthCents)}</b>,
             ${plata(resumen.projectedEndOfMonthCents - resumen.budgetedCents)} por encima de lo que
             tienes.</p>`
        : '';

    const pendientes =
      resumen.pendingReviewCount > 0
        ? `<p class="pista" style="margin-top:10px">${resumen.pendingReviewCount} gasto(s) esperando que los confirmes,
             por ${plata(resumen.pendingReviewCents)}. Todavía no consumen presupuesto.</p>`
        : '';

    caja.innerHTML = `
      <div class="tablero__titular">
        <div>
          <div class="rotulo">${titular}</div>
          <div class="tablero__monto cifra">${plata(monto)}</div>
        </div>
        <div class="tablero__contexto">${contexto}</div>
      </div>

      <div class="barra" data-estado="${resumen.state}">
        <div class="barra__pista">
          <span class="barra__seg barra__seg--gastado" style="width:${anchoGastado}%"></span>
          <span class="barra__seg barra__seg--comprometido" style="width:${anchoFijos}%"></span>
        </div>
        ${esMesActual ? `<span class="barra__hoy" style="left:${posicionHoy}%"></span>` : ''}
        <div class="barra__leyenda">
          <span class="barra__clave">
            <i class="barra__muestra"></i> Gastado <b>${plata(resumen.spentCents)}</b>
          </span>
          <span class="barra__clave">
            <i class="barra__muestra barra__muestra--comprometido"></i> Fijos por pagar
            <b>${plata(resumen.committedCents)}</b>
          </span>
          <span class="barra__clave">
            <i class="barra__muestra barra__muestra--libre"></i> Libre <b>${plata(libre)}</b>
          </span>
          ${
            resumen.othersShareCents > 0
              ? `<span class="barra__clave">De otros <b>${plata(resumen.othersShareCents)}</b></span>`
              : ''
          }
          ${
            debo.totalPendingCents > 0
              ? `<span class="barra__clave barra__clave--debo">Yo debo <b>${plata(debo.totalPendingCents)}</b></span>`
              : ''
          }
        </div>
      </div>
      ${noCaben}
      ${proyeccion}
      ${pendientes}
    `;
  }

  /* ══ Vista: resumen ══════════════════════════════════════════════ */

  function vistaResumen(resumen) {
    const cuentas = porCobrar();
    const mias = porPagar();
    const recientes = gastosDelMes(mes).slice(0, 8);

    return `
      ${bloqueCategorias(resumen)}
      <div class="dupla">
        ${bloqueRecientes(recientes)}
        <div style="display:flex;flex-direction:column;gap:28px">
          ${bloqueDeudasCorto(cuentas)}
          ${bloqueDeboCorto(mias)}
          ${bloqueDonde()}
        </div>
      </div>
      <div class="dupla">
        ${bloqueRitmo(resumen)}
        ${bloqueMeses()}
      </div>
    `;
  }

  function gastosDelMes(clave) {
    return gastosVivos()
      .filter((g) => M.monthKeyOf(g.occurredAt, OFFSET) === clave)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  function bloqueCategorias(resumen) {
    const filas = resumen.byCategory.filter((c) => c.spentCents > 0 || c.committedCents > 0 || c.limitCents);

    if (filas.length === 0) {
      return `
        <section class="bloque">
          <div class="bloque__cabeza"><h2>En qué se te va</h2></div>
          <div class="vacio">
            <strong>Todavía no hay nada este mes</strong>
            Registra tu primer gasto y aquí verás cómo se reparte.
          </div>
        </section>`;
    }

    const total = resumen.spentCents;

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>En qué se te va</h2>
          <span class="rotulo">Solo tu parte</span>
        </div>
        <div class="tarjeta">
          ${filas
            .map((c) => {
              const consumido = c.spentCents + c.committedCents;
              const porcentaje = c.ratio !== null ? Math.min(c.ratio * 100, 100) : 0;
              const parte = total > 0 ? Math.round((c.spentCents / total) * 100) : 0;

              const nota = notaCategoria(c, parte);

              return `
                <div class="categoria">
                  <div class="categoria__nombre">
                    <i class="categoria__mecha" style="background:${colorCategoria(c.categoryId)}"></i>
                    <span>${escapar(nombreCategoria(c.categoryId))}</span>
                  </div>
                  <div class="categoria__cifra">
                    ${plata(consumido)}
                    ${c.limitCents !== null ? `<small> / ${plata(c.limitCents)}</small>` : ''}
                  </div>
                  ${
                    c.limitCents !== null
                      ? `<div class="medidor">
                           <span class="medidor__relleno" data-estado="${c.state}" style="width:${porcentaje}%"></span>
                         </div>`
                      : ''
                  }
                  <div class="categoria__nota" data-estado="${c.state}">${nota}</div>
                </div>`;
            })
            .join('')}
        </div>
      </section>`;
  }

  /**
   * Una categoría puede tener plata gastada, plata reservada en un fijo que
   * todavía no se paga, o las dos. Decirle "0% de tu gasto" a un arriendo que
   * está reservado y sin pagar solo confunde.
   */
  function notaCategoria(fila, parte) {
    const reservado = fila.committedCents > 0;

    if (fila.limitCents !== null) {
      const base = `de ${plata(fila.limitCents)}`;
      const cola = reservado ? ` · incluye ${plata(fila.committedCents)} reservados` : '';
      return fila.availableCents >= 0
        ? `Te quedan ${plata(fila.availableCents)} ${base}${cola}`
        : `Te pasaste ${plata(-fila.availableCents)} del tope ${base}${cola}`;
    }

    if (fila.spentCents === 0 && reservado) {
      return `Reservado para un gasto fijo, todavía sin pagar`;
    }

    return `${parte}% de tu gasto del mes${
      reservado ? ` · ${plata(fila.committedCents)} más reservados en fijos` : ''
    }`;
  }

  function bloqueRecientes(lista) {
    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Últimos gastos</h2>
          <button type="button" class="boton boton--fantasma boton--chico" data-ir="gastos">Ver todos</button>
        </div>
        ${lista.length === 0 ? sinNada('Aún no hay gastos este mes.') : `<div class="lista">${lista.map(renglonGasto).join('')}</div>`}
      </section>`;
  }

  function renglonGasto(gasto) {
    const partes = repartosDe(gasto.id);
    const compartido = partes.length > 0;
    const quienes = partes
      .map((p) => personaPorId(p.personId)?.name)
      .filter(Boolean)
      .join(', ');

    const detalle = [
      nombreCategoria(gasto.categoryId),
      cuentaPorId(gasto.accountId)?.name,
      compartido ? `con ${quienes}` : null,
      gasto.source === 'recurring' ? 'fijo' : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return `
      <button type="button" class="renglon" data-gasto="${gasto.id}">
        <span class="punto" style="background:${colorCategoria(gasto.categoryId)}">
          ${escapar(nombreCategoria(gasto.categoryId).slice(0, 1))}
        </span>
        <span class="renglon__medio">
          <span class="renglon__titulo">${escapar(gasto.merchantRaw || gasto.description || nombreCategoria(gasto.categoryId))}</span>
          <span class="renglon__detalle">${escapar(detalle)}</span>
        </span>
        <span class="renglon__cifras">
          <span class="renglon__monto">${plata(gasto.amountTotalCents)}</span>
          ${compartido ? `<span class="renglon__aparte">tuyo ${plata(gasto.myShareCents)}</span>` : ''}
        </span>
      </button>`;
  }

  function bloqueDeudasCorto(cuentas) {
    const conSaldo = cuentas.byPerson.filter((p) => p.netCents !== 0);

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Te deben</h2>
          <button type="button" class="boton boton--fantasma boton--chico" data-ir="personas">Ver detalle</button>
        </div>
        ${
          conSaldo.length === 0
            ? sinNada('Nadie te debe nada. Vas al día.')
            : `<div class="tarjeta">
                 ${conSaldo
                   .map((p) => {
                     const persona = personaPorId(p.personId);
                     const signo = p.netCents > 0 ? 'debe' : 'favor';
                     return `
                       <div class="persona">
                         <div class="persona__cabeza">
                           <span class="avatar">${escapar(iniciales(persona?.name ?? '?'))}</span>
                           <span class="persona__nombre">${escapar(persona?.name ?? 'Alguien')}</span>
                           <span class="persona__saldo" data-signo="${signo}">
                             ${p.netCents > 0 ? plata(p.netCents) : `${plata(-p.netCents)} a favor`}
                           </span>
                         </div>
                       </div>`;
                   })
                   .join('')}
               </div>
               <p class="pista">Total pendiente <b class="cifra">${plata(cuentas.totalPendingCents)}</b></p>`
        }
      </section>`;
  }

  function bloqueDeboCorto(mias) {
    const conSaldo = mias.byPerson.filter((p) => p.pendingCents > 0);

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Debes</h2>
          <button type="button" class="boton boton--fantasma boton--chico" data-ir="personas">Ver detalle</button>
        </div>
        ${
          conSaldo.length === 0
            ? sinNada('No le debes nada a nadie. Vas al día.')
            : `<div class="tarjeta">
                 ${conSaldo
                   .map((p) => {
                     const persona = personaPorId(p.personId);
                     return `
                       <div class="persona">
                         <div class="persona__cabeza">
                           <span class="avatar">${escapar(iniciales(persona?.name ?? '?'))}</span>
                           <span class="persona__nombre">${escapar(persona?.name ?? 'Alguien')}</span>
                           <span class="persona__saldo" data-signo="pago">${plata(p.pendingCents)}</span>
                         </div>
                       </div>`;
                   })
                   .join('')}
               </div>
               <p class="pista">Total pendiente <b class="cifra">${plata(mias.totalPendingCents)}</b></p>`
        }
      </section>`;
  }

  function bloqueDonde() {
    const top = M.topMerchants(gastosVivos(), mes, { utcOffset: OFFSET, limit: 5 });
    if (top.length === 0) return '';

    return `
      <section class="bloque">
        <div class="bloque__cabeza"><h2>Dónde más gastas</h2></div>
        <div class="tarjeta">
          ${top
            .map(
              (t) => `
              <div class="categoria">
                <div class="categoria__nombre"><span>${escapar(t.merchant)}</span></div>
                <div class="categoria__cifra">${plata(t.spentCents)}</div>
                <div class="categoria__nota">${t.expenseCount} vez${t.expenseCount === 1 ? '' : 'es'}</div>
              </div>`,
            )
            .join('')}
        </div>
      </section>`;
  }

  function bloqueRitmo(resumen) {
    const serie = M.dailySeries(gastosVivos(), mes, {
      utcOffset: OFFSET,
      budgetCents: resumen.hasBudget ? resumen.budgetedCents : null,
      now: new Date(),
    });

    const pasados = serie.filter((p) => !p.isFuture);
    if (pasados.length < 2) {
      return `
        <section class="bloque">
          <div class="bloque__cabeza"><h2>Ritmo del mes</h2></div>
          ${sinNada('Con un par de días de gastos aparece la curva.')}
        </section>`;
    }

    const ancho = 320;
    const alto = 120;
    const techo = Math.max(
      ...serie.map((p) => Math.max(p.cumulativeCents, p.idealCumulativeCents ?? 0)),
      1,
    );

    const x = (dia) => ((dia - 1) / (serie.length - 1)) * ancho;
    const y = (valor) => alto - (valor / techo) * alto;

    const linea = pasados.map((p) => `${x(p.day).toFixed(1)},${y(p.cumulativeCents).toFixed(1)}`).join(' ');
    const area = `${x(1).toFixed(1)},${alto} ${linea} ${x(pasados[pasados.length - 1].day).toFixed(1)},${alto}`;
    const ideal = resumen.hasBudget
      ? serie.map((p) => `${x(p.day).toFixed(1)},${y(p.idealCumulativeCents ?? 0).toFixed(1)}`).join(' ')
      : null;

    const ultimo = pasados[pasados.length - 1];
    const referencia = ultimo.idealCumulativeCents ?? null;
    const veredicto =
      referencia === null
        ? 'Sin presupuesto no hay con qué comparar el ritmo.'
        : ultimo.cumulativeCents <= referencia
          ? `Vas <b class="cifra">${plata(referencia - ultimo.cumulativeCents)}</b> por debajo del ritmo parejo.`
          : `Vas <b class="cifra">${plata(ultimo.cumulativeCents - referencia)}</b> por encima del ritmo parejo.`;

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Ritmo del mes</h2>
          <span class="rotulo">Acumulado</span>
        </div>
        <div class="tarjeta" style="padding:16px">
          <svg class="grafica" viewBox="0 -6 ${ancho} ${alto + 12}" preserveAspectRatio="none" role="img"
               aria-label="Gasto acumulado del mes comparado con el ritmo parejo del presupuesto">
            <polygon class="grafica__area" points="${area}" />
            ${ideal ? `<polyline class="grafica__ideal" points="${ideal}" />` : ''}
            <polyline class="grafica__linea" points="${linea}" />
            <line class="grafica__eje" x1="0" y1="${alto}" x2="${ancho}" y2="${alto}" />
          </svg>
          <p class="pista" style="margin-top:12px">${veredicto}</p>
        </div>
      </section>`;
  }

  function bloqueMeses() {
    const serie = M.monthlyTrend(gastosVivos(), mes, { utcOffset: OFFSET, count: 6 });
    const techo = Math.max(...serie.map((p) => p.spentCents), 1);

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Últimos meses</h2>
          <span class="rotulo">Tu parte</span>
        </div>
        <div class="tarjeta" style="padding:16px">
          <div class="columnas">
            ${serie
              .map((p) => {
                const corto = new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(
                  new Date(Date.UTC(M.splitMonthKey(p.month).year, M.splitMonthKey(p.month).month - 1, 15)),
                );
                return `
                  <div class="columna ${p.month === mes ? 'columna--actual' : ''}">
                    <span class="columna__barra" style="height:${(p.spentCents / techo) * 100}%"
                          title="${escapar(nombreMes(p.month))}: ${plata(p.spentCents)}"></span>
                    <span class="columna__rotulo">${escapar(corto.replace('.', ''))}</span>
                  </div>`;
              })
              .join('')}
          </div>
        </div>
      </section>`;
  }

  const sinNada = (texto) => `<div class="vacio">${escapar(texto)}</div>`;

  /* ══ Vista: gastos ═══════════════════════════════════════════════ */

  function vistaGastos() {
    const lista = gastosDelMes(mes);

    if (lista.length === 0) {
      return `
        <section class="bloque">
          <div class="bloque__cabeza"><h2>Gastos de ${escapar(nombreMes(mes))}</h2></div>
          <div class="vacio">
            <strong>Este mes está en blanco</strong>
            Registra un gasto y aparecerá aquí, agrupado por día.
          </div>
        </section>`;
    }

    const porDia = new Map();
    for (const gasto of lista) {
      const dia = diaDeIso(gasto.occurredAt);
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(gasto);
    }

    const total = lista.reduce((suma, g) => suma + g.myShareCents, 0);

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Gastos de ${escapar(nombreMes(mes))}</h2>
          <span class="rotulo">${lista.length} movimientos · ${plata(total)} tuyos</span>
        </div>
        <div class="lista">
          ${Array.from(porDia.entries())
            .map(([dia, gastos]) => {
              const suma = gastos.reduce((s, g) => s + g.myShareCents, 0);
              return `
                <div class="dia"><b>${escapar(nombreDia(dia))}</b><span>${plata(suma)}</span></div>
                ${gastos.map(renglonGasto).join('')}`;
            })
            .join('')}
        </div>
      </section>`;
  }

  /* ══ Vista: presupuesto ══════════════════════════════════════════ */

  function vistaPresupuesto(resumen) {
    const presu = presupuestoDe(mes);
    const sumaTopes = Object.values(presu.limites ?? {}).reduce((s, v) => s + (v || 0), 0);

    const desfase =
      presu.totalCents > 0 && sumaTopes > 0
        ? sumaTopes > presu.totalCents
          ? `Tus topes por categoría suman ${plata(sumaTopes)}, o sea ${plata(sumaTopes - presu.totalCents)} más de lo que tienes para el mes.`
          : `Tus topes suman ${plata(sumaTopes)}. Quedan ${plata(presu.totalCents - sumaTopes)} sin asignar a ninguna categoría.`
        : '';

    const mesAnterior = M.addMonths(mes, -1);
    const anterior = presupuestoDe(mesAnterior);

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Con cuánto cuentas en ${escapar(nombreMes(mes))}</h2>
          ${
            anterior.totalCents > 0 && presu.totalCents === 0
              ? `<button type="button" class="boton boton--fantasma boton--chico" data-copiar-presupuesto>
                   Copiar el del mes pasado
                 </button>`
              : ''
          }
        </div>
        <div class="tarjeta" style="padding:16px">
          <label class="campo campo--monto" style="max-width:280px">
            <span class="campo__etiqueta">Toda la plata del mes</span>
            <div class="monto">
              <span class="monto__signo">$</span>
              <input class="monto__entrada" data-presupuesto-total inputmode="numeric"
                     placeholder="0" value="${textoDesdeCentavos(presu.totalCents)}" />
            </div>
          </label>
          <p class="pista" style="margin-top:12px">
            De aquí salen los gastos fijos, lo que ahorras y el gasto del día a día. Si el ahorro te
            lo cobras como un fijo, esta cifra tiene que ser todo lo que te entra.
          </p>
          ${desfase ? `<p class="pista" style="margin-top:8px">${desfase}</p>` : ''}
        </div>
      </section>

      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Categorías y topes</h2>
          <button type="button" class="boton boton--marco boton--chico" data-abrir="categoria">
            Nueva categoría
          </button>
        </div>
        <p class="pista">
          Un tope es para lo que decides cada vez: mercado, gasolina, salidas. Lo que llega solo cada
          mes va en Fijos. Deja en blanco las categorías que no quieras vigilar; lo gastado incluye
          los fijos reservados de esa categoría.
        </p>
        <div class="tarjeta">
          ${categoriasActivas()
            .map((categoria) => {
              const fila = resumen.byCategory.find((c) => c.categoryId === categoria.id);
              const gastado = (fila?.spentCents ?? 0) + (fila?.committedCents ?? 0);
              const tope = presu.limites?.[categoria.id] ?? 0;

              return `
                <div class="categoria categoria--tope">
                  <div class="categoria__nombre">
                    <i class="categoria__mecha" style="background:${categoria.color}"></i>
                    <span>${escapar(categoria.name)}</span>
                    <button type="button" class="icono icono--mini" data-editar-categoria="${categoria.id}"
                            aria-label="Cambiar nombre o color de ${escapar(categoria.name)}">✎</button>
                  </div>
                  <div class="categoria__controles">
                    <span class="categoria__usados">${plata(gastado)} usados</span>
                    <input class="entrada tope" inputmode="numeric" placeholder="sin tope"
                           aria-label="Tope de ${escapar(categoria.name)}"
                           data-tope="${categoria.id}" value="${textoDesdeCentavos(tope)}" />
                    <button type="button" class="icono icono--mini" data-borrar-categoria="${categoria.id}"
                            aria-label="Quitar ${escapar(categoria.name)}">✕</button>
                  </div>
                </div>`;
            })
            .join('')}
        </div>
      </section>

      ${bloqueCategoriasGuardadas()}`;
  }

  function bloqueCategoriasGuardadas() {
    const guardadas = datos.categorias.filter((c) => c.isArchived);
    if (guardadas.length === 0) return '';

    return `
      <section class="bloque">
        <div class="bloque__cabeza"><h2>Categorías guardadas</h2></div>
        <p class="pista">
          Ya no aparecen al registrar un gasto, pero sus movimientos siguen en el historial.
          Tócalas para volver a usarlas.
        </p>
        <div class="fichas">
          ${guardadas
            .map(
              (c) => `
              <button type="button" class="ficha" data-restaurar-categoria="${c.id}">
                <i class="categoria__mecha" style="background:${c.color}"></i>
                ${escapar(c.name)}
              </button>`,
            )
            .join('')}
        </div>
      </section>`;
  }

  /* ══ Vista: personas ═════════════════════════════════════════════ */

  function vistaPersonas() {
    const cuentas = porCobrar();
    const mias = porPagar();

    const rotulo =
      [
        cuentas.totalPendingCents > 0 ? `${plata(cuentas.totalPendingCents)} por cobrar` : '',
        mias.totalPendingCents > 0 ? `${plata(mias.totalPendingCents)} por pagar` : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'Todo al día';

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Personas</h2>
          <span class="rotulo">${rotulo}</span>
        </div>

        <div class="personas-alta">
          <button type="button" class="boton boton--marco" data-mostrar-nueva-persona ${agregandoPersona ? 'hidden' : ''}>
            Agregar persona
          </button>
          <button type="button" class="boton boton--marco" data-abrir-debo ${agregandoPersona ? 'hidden' : ''}>
            Registrar deuda
          </button>
          <form class="linea-alta" data-nueva-persona ${agregandoPersona ? '' : 'hidden'}>
            <input class="entrada" name="nombre" placeholder="Nombre de la persona" style="max-width:220px" required />
            <input class="entrada" name="correo" type="email" placeholder="Correo de su cuenta (opcional)" style="max-width:240px" />
            <button type="submit" class="boton boton--solido">Agregar</button>
            <button type="button" class="boton boton--fantasma" data-cancelar-nueva-persona>Cancelar</button>
          </form>
        </div>

        ${
          datos.personas.length === 0
            ? `<div class="vacio">
                 <strong>Todavía no hay nadie</strong>
                 Agrega a quien compartes gastos y podrás derivarle una parte al registrar.
               </div>`
            : `<div class="tarjeta">
                 ${datos.personas.map((persona) => tarjetaPersona(persona, cuentas, mias)).join('')}
               </div>`
        }
      </section>`;
  }

  function tarjetaPersona(persona, cuentas, mias) {
    const cuenta = cuentas.byPerson.find((p) => p.personId === persona.id);
    const mio = mias.byPerson.find((p) => p.personId === persona.id);

    const pendienteCobrar = cuenta?.pendingCents ?? 0;
    const pendientePagar = mio?.pendingCents ?? 0;

    const itemsCobrar = [
      ...(cuenta?.items ?? []).filter((item) => !item.isSettled),
      ...(cuenta?.items ?? []).filter((item) => item.isSettled).slice(0, 3),
    ];
    const itemsPagar = [
      ...(mio?.items ?? []).filter((d) => !d.settledAt),
      ...(mio?.items ?? []).filter((d) => d.settledAt).slice(0, 3),
    ];

    const usada =
      datos.repartos.some((r) => r.personId === persona.id) ||
      datos.deudas.some((d) => d.personId === persona.id);

    const hayBloqueCobrar =
      pendienteCobrar > 0 || itemsCobrar.length > 0 || (cuenta?.creditCents ?? 0) > 0;
    const hayBloquePagar = pendientePagar > 0 || itemsPagar.length > 0;

    // Los montos viven en cada bloque; aquí solo decimos si está al día.
    const saldos = [];
    if (!hayBloqueCobrar && !hayBloquePagar) {
      saldos.push({ signo: 'cero', texto: 'Al día' });
    }

    const bloqueCobrar = hayBloqueCobrar
        ? `<div class="persona__bloque persona__bloque--cobrar">
             <div class="persona__bloque-cabeza">
               <span class="persona__bloque-titulo">Te debe</span>
               <span class="persona__bloque-total cifra">${plata(pendienteCobrar)}</span>
             </div>
             <div class="persona__bloque-lista">
               ${
                 itemsCobrar.length > 0
                   ? itemsCobrar.map((item) => filaDeudaCobrar(item, persona)).join('')
                   : `<p class="persona__bloque-vacio">Sin gastos compartidos pendientes.</p>`
               }
               ${
                 (cuenta?.creditCents ?? 0) > 0
                   ? `<div class="deuda">
                        <span class="deuda__que">Saldo a favor sin aplicar</span>
                        <span class="deuda__cuanto">${plata(cuenta.creditCents)}</span>
                      </div>`
                   : ''
               }
             </div>
           </div>`
        : '';

    const bloquePagar = hayBloquePagar
        ? `<div class="persona__bloque persona__bloque--pagar">
             <div class="persona__bloque-cabeza">
               <span class="persona__bloque-titulo">Le debes</span>
               <span class="persona__bloque-total cifra">${plata(pendientePagar)}</span>
             </div>
             <div class="persona__bloque-lista">
               ${
                 itemsPagar.length > 0
                   ? itemsPagar.map((deuda) => filaDeudaPagar(deuda)).join('')
                   : `<p class="persona__bloque-vacio">Sin deudas pendientes.</p>`
               }
             </div>
           </div>`
        : '';

    return `
      <div class="persona">
        <div class="persona__cabeza">
          <span class="avatar">${escapar(iniciales(persona.name))}</span>
          <div class="persona__identidad">
            <span class="persona__nombre">${escapar(persona.name)}</span>
            <button type="button" class="icono icono--mini" data-editar-correo-persona="${persona.id}"
                    aria-label="${persona.email ? `Cambiar correo de ${escapar(persona.name)}` : `Asociar correo de ${escapar(persona.name)}`}">
              ✎
            </button>
          </div>
          ${saldos
            .map((s) => `<span class="persona__saldo" data-signo="${s.signo}">${s.texto}</span>`)
            .join('')}
          <div class="persona__acciones">
            ${
              pendienteCobrar > 0
                ? `<button type="button" class="boton boton--marco boton--chico" data-abonar="${persona.id}">
                     Registrar abono
                   </button>`
                : ''
            }
            <button type="button" class="boton boton--marco boton--chico" data-debo-persona="${persona.id}">
              Registrar deuda
            </button>
          </div>
          ${
            usada
              ? ''
              : `<button type="button" class="icono" data-borrar-persona="${persona.id}" aria-label="Quitar a ${escapar(persona.name)}">✕</button>`
          }
        </div>

        ${bloqueCobrar || bloquePagar ? `<div class="persona__cuerpo">${bloqueCobrar}${bloquePagar}</div>` : ''}
      </div>`;
  }

  function filaDeudaCobrar(item, persona) {
    const titulo = `${escapar(nombreDelGasto(item.expenseId, nombreCategoria(item.categoryId)))} · ${escapar(nombreDia(diaDeIso(item.occurredAt)))}`;
    const reparto = datos.repartos.find((r) => r.id === item.splitId);
    const yaAvisado = Boolean(reparto?.notifiedAt);
    return `
      <div class="deuda ${item.isSettled ? 'deuda--saldada' : ''}">
        <button type="button" class="deuda__principal" data-gasto="${item.expenseId}">
          <span class="deuda__que">${titulo}</span>
          <span class="deuda__cuanto">${plata(item.pendingCents || item.amountCents)}</span>
        </button>
        ${
          item.isSettled
            ? ''
            : yaAvisado
              ? `<button type="button" class="boton boton--fantasma boton--chico"
                         data-recordar="${item.splitId}"
                         aria-label="Recordarle a ${escapar(persona.name)}">Recordar</button>`
              : `<button type="button" class="boton boton--fantasma boton--chico"
                         data-avisar="${item.splitId}"
                         aria-label="Avisarle a ${escapar(persona.name)}">Avisar</button>`
        }
      </div>`;
  }

  function filaDeudaPagar(deuda) {
    const titulo = `${escapar(deuda.description || 'un gasto')} · ${escapar(nombreDia(diaDeIso(deuda.occurredAt)))}`;
    return `
      <div class="deuda ${deuda.settledAt ? 'deuda--saldada' : ''}">
        <button type="button" class="deuda__principal" data-deuda="${deuda.id}">
          <span class="deuda__que">${titulo}</span>
          <span class="deuda__cuanto">${plata(deuda.amountCents)}</span>
        </button>
        <button type="button" class="boton boton--fantasma boton--chico" data-pague="${deuda.id}">
          ${deuda.settledAt ? 'Deshacer' : 'Pagué'}
        </button>
      </div>`;
  }

  /* ══ Vista: fijos ════════════════════════════════════════════════ */

  function vistaFijos() {
    const instancias = instanciasDelMes(mes);
    const reservado = instancias
      .filter((i) => i.status === 'planned')
      .reduce((s, i) => s + i.plannedCents, 0);

    return `
      <section class="bloque">
        <div class="bloque__cabeza">
          <h2>Gastos fijos</h2>
          <button type="button" class="boton boton--marco boton--chico" data-abrir="fijo">Nuevo fijo</button>
        </div>
        <p class="pista">
          Los que llegan solos: arriendo, cuotas, servicios. No son plata aparte, salen de lo que
          tienes para el mes, pero se descuentan desde el día 1 aunque no los hayas pagado, para que
          el disponible nunca te mienta. Lo que decides comprar cada vez, como la gasolina, funciona
          mejor como tope de categoría.
          ${reservado > 0 ? `Este mes quedan <b class="cifra">${plata(reservado)}</b> por pagar.` : ''}
        </p>

        ${
          datos.fijos.filter((f) => !f.isArchived).length === 0
            ? `<div class="vacio">
                 <strong>Sin gastos fijos</strong>
                 Arriendo, servicios, suscripciones: lo que se repite cada mes.
               </div>`
            : `<div class="tarjeta">
                 ${instancias
                   .map((instancia) => {
                     const fijo = datos.fijos.find((f) => f.id === instancia.recurringId);
                     if (!fijo) return '';

                     const pagado = instancia.status === 'posted';
                     const saltado = instancia.status === 'skipped';

                     return `
                       <div class="categoria">
                         <div class="categoria__nombre">
                           <i class="categoria__mecha" style="background:${colorCategoria(fijo.categoryId)}"></i>
                           <span>${escapar(fijo.name)}</span>
                           <button type="button" class="icono" data-editar-fijo="${fijo.id}"
                                   aria-label="Editar ${escapar(fijo.name)}" style="width:24px;height:24px">✎</button>
                         </div>
                         <div style="justify-self:end">
                           ${
                             pagado
                               ? `<span class="categoria__cifra" style="color:var(--verde)">Pagado ${plata(instancia.plannedCents)}</span>`
                               : saltado
                                 ? `<span class="categoria__cifra" style="color:var(--tinta-3)">Saltado este mes</span>`
                                 : `<span style="display:inline-flex;gap:6px;align-items:center">
                                      <input class="entrada" style="width:120px;height:32px;text-align:right;font-family:var(--mono)"
                                             inputmode="numeric" data-monto-instancia="${instancia.id}"
                                             value="${textoDesdeCentavos(instancia.plannedCents)}" />
                                      <button type="button" class="boton boton--marco boton--chico"
                                              data-pagar="${instancia.id}">Pagar</button>
                                      <button type="button" class="boton boton--fantasma boton--chico"
                                              data-saltar="${instancia.id}">Saltar</button>
                                    </span>`
                           }
                         </div>
                         <div class="categoria__nota">
                           ${escapar(nombreCategoria(fijo.categoryId))} · día ${fijo.dayOfMonth}
                           ${fijo.isVariable ? ' · monto variable' : ''}
                         </div>
                       </div>`;
                   })
                   .join('')}
               </div>`
        }
      </section>`;
  }

  /* ══ Pintado general ═════════════════════════════════════════════ */

  function pintar() {
    asegurarInstancias(mes);

    const resumen = resumenDelMes(mes);

    document.getElementById('mes-nombre').textContent = nombreMes(mes);
    pintarTablero(resumen);

    document.querySelectorAll('.pestana').forEach((boton) => {
      const activa = boton.dataset.vista === vista;
      if (activa) boton.setAttribute('aria-current', 'page');
      else boton.removeAttribute('aria-current');
    });

    const lienzo = document.getElementById('lienzo');
    if (vista === 'resumen') lienzo.innerHTML = vistaResumen(resumen);
    else if (vista === 'gastos') lienzo.innerHTML = vistaGastos();
    else if (vista === 'presupuesto') lienzo.innerHTML = vistaPresupuesto(resumen);
    else if (vista === 'personas') lienzo.innerHTML = vistaPersonas();
    else if (vista === 'fijos') lienzo.innerHTML = vistaFijos();
  }

  /* ══ Diálogo de gasto ════════════════════════════════════════════ */

  const dialogoGasto = document.getElementById('dialogo-gasto');
  const formaGasto = document.getElementById('forma-gasto');

  let borrador = null;

  function abrirGasto(gastoExistente) {
    const partes = gastoExistente ? repartosDe(gastoExistente.id) : [];

    borrador = {
      id: gastoExistente?.id ?? null,
      categoriaId: gastoExistente?.categoryId ?? categoriasActivas()[0]?.id ?? null,
      personas: partes.map((p) => p.personId),
      modo: partes.length > 0 ? 'amounts' : 'equal',
      incluirme: true,
      montos: Object.fromEntries(partes.map((p) => [p.personId, p.amountCents])),
      porcentajes: {},
    };

    document.getElementById('titulo-gasto').textContent = gastoExistente
      ? 'Editar gasto'
      : 'Registrar gasto';
    document.getElementById('gasto-guardar').textContent = gastoExistente
      ? 'Guardar cambios'
      : 'Guardar gasto';
    document.getElementById('gasto-eliminar').hidden = !gastoExistente;

    document.getElementById('gasto-monto').value = gastoExistente
      ? textoDesdeCentavos(gastoExistente.amountTotalCents)
      : '';
    document.getElementById('gasto-comercio').value = gastoExistente?.merchantRaw ?? '';
    document.getElementById('gasto-fecha').value = gastoExistente
      ? diaDeIso(gastoExistente.occurredAt)
      : hoyDia();

    const selectorCuenta = document.getElementById('gasto-cuenta');
    selectorCuenta.innerHTML = datos.cuentas
      .map((c) => `<option value="${c.id}">${escapar(c.name)}</option>`)
      .join('');
    selectorCuenta.value = gastoExistente?.accountId ?? datos.cuentas[0]?.id ?? '';

    document.getElementById('comercios-vistos').innerHTML = Array.from(
      new Set(gastosVivos().map((g) => g.merchantRaw).filter(Boolean)),
    )
      .slice(0, 40)
      .map((m) => `<option value="${escapar(m)}"></option>`)
      .join('');

    document.getElementById('gasto-incluirme').checked = true;

    pintarCategoriasForma();
    pintarPersonasForma();
    refrescarReparto();

    dialogoGasto.showModal();
    setTimeout(() => document.getElementById('gasto-monto').focus(), 40);
  }

  function pintarCategoriasForma() {
    // Si el gasto que estás editando usa una categoría guardada, se muestra
    // igual: si no, editarlo la cambiaría sin que te des cuenta.
    const lista = categoriasActivas();
    const actual = categoriaPorId(borrador.categoriaId);
    if (actual?.isArchived) lista.push(actual);

    document.getElementById('gasto-categorias').innerHTML =
      lista
        .map(
          (c) => `
          <button type="button" class="ficha-categoria" data-categoria="${c.id}"
                  aria-pressed="${c.id === borrador.categoriaId}">
            <i class="categoria__mecha" style="background:${c.color}"></i>
            <span>${escapar(c.name)}</span>
          </button>`,
        )
        .join('') +
      `<button type="button" class="ficha-categoria ficha-categoria--sumar" data-categoria-nueva>
         <span>+ Nueva</span>
       </button>`;
  }

  function pintarPersonasForma() {
    const caja = document.getElementById('gasto-personas');
    caja.innerHTML =
      datos.personas
        .map(
          (p) => `
          <button type="button" class="ficha" data-persona="${p.id}"
                  aria-pressed="${borrador.personas.includes(p.id)}">${escapar(p.name)}</button>`,
        )
        .join('') + `<button type="button" class="ficha ficha--sumar" data-persona-nueva>+ Alguien nuevo</button>`;
  }

  /** Traduce lo que hay en el formulario a un plan que el motor entienda. */
  function planDelBorrador() {
    if (borrador.personas.length === 0) return null;

    if (borrador.modo === 'equal') {
      return { mode: 'equal', personIds: borrador.personas, includeMe: borrador.incluirme };
    }
    if (borrador.modo === 'percent') {
      return {
        mode: 'percent',
        entries: borrador.personas.map((p) => ({
          participantId: p,
          percent: borrador.porcentajes[p] ?? 0,
        })),
      };
    }
    return {
      mode: 'amounts',
      entries: borrador.personas.map((p) => ({
        participantId: p,
        amountCents: borrador.montos[p] ?? 0,
      })),
    };
  }

  function repartoResuelto() {
    const total = centavosDesdeTexto(document.getElementById('gasto-monto').value);
    const plan = planDelBorrador();
    if (!plan) return { total, myShareCents: total, splits: [], error: null };

    try {
      const resuelto = M.resolveSplitPlan(total, plan);
      return { total, ...resuelto, error: null };
    } catch (error) {
      return { total, myShareCents: total, splits: [], error: error.message };
    }
  }

  function refrescarReparto() {
    const hayGente = borrador.personas.length > 0;
    document.getElementById('reparto-modo').hidden = !hayGente;
    document.getElementById('reparto-pista').textContent = hayGente
      ? 'Tu presupuesto solo cuenta tu parte'
      : 'Nadie más: el gasto es todo tuyo';

    document.querySelectorAll('#reparto-modo .segmento').forEach((boton) => {
      boton.setAttribute('aria-pressed', String(boton.dataset.modo === borrador.modo));
    });

    document
      .getElementById('gasto-incluirme')
      .closest('.interruptor')
      .toggleAttribute('hidden', borrador.modo !== 'equal');

    const detalle = document.getElementById('reparto-detalle');
    if (!hayGente) {
      detalle.innerHTML = '';
      document.getElementById('reparto-resultado').textContent = '';
      actualizarOpcionAvisarGasto();
      return;
    }

    if (borrador.modo === 'equal') {
      detalle.innerHTML = '';
    } else {
      const esPorcentaje = borrador.modo === 'percent';
      detalle.innerHTML = borrador.personas
        .map((idPersona) => {
          const persona = personaPorId(idPersona);
          const valor = esPorcentaje
            ? (borrador.porcentajes[idPersona] ?? '')
            : textoDesdeCentavos(borrador.montos[idPersona] ?? 0);
          return `
            <div class="reparto__fila">
              <span>${escapar(persona?.name ?? '')}</span>
              <input class="entrada" inputmode="numeric" data-valor-persona="${idPersona}"
                     placeholder="${esPorcentaje ? '%' : '$'}" value="${valor}" />
            </div>`;
        })
        .join('');
    }

    pintarResultadoReparto();
  }

  /** Solo la línea de resultado, para poder refrescarla sin robarle el foco a un input. */
  function pintarResultadoReparto() {
    const resultado = repartoResuelto();
    const salida = document.getElementById('reparto-resultado');

    if (resultado.error) {
      salida.dataset.error = 'true';
      salida.textContent = resultado.error;
      return;
    }

    salida.dataset.error = 'false';
    const deOtros = resultado.splits
      .filter((s) => s.amountCents > 0)
      .map((s) => `${escapar(personaPorId(s.personId)?.name ?? '')} te debe <b>${plata(s.amountCents)}</b>`)
      .join(' · ');

    salida.innerHTML = `Tu parte: <b>${plata(resultado.myShareCents)}</b>${deOtros ? ` · ${deOtros}` : ''}`;
    actualizarOpcionAvisarGasto();
  }

  function personaUsaApp(idPersona) {
    return Boolean(personaPorId(idPersona)?.email);
  }

  function actualizarOpcionAvisarGasto() {
    const wrap = document.getElementById('gasto-avisar-wrap');
    if (!wrap || !borrador) return;

    const conCorreo = borrador.personas.filter((idPersona) => personaUsaApp(idPersona));
    wrap.hidden = conCorreo.length === 0;
    if (conCorreo.length === 0) return;

    const nombres = conCorreo.map((id) => personaPorId(id)?.name).filter(Boolean).join(', ');
    const editando = Boolean(borrador.id);
    document.getElementById('gasto-avisar-texto').textContent = editando
      ? `Avisar de nuevo a ${nombres} si cambió su parte`
      : `Avisar a ${nombres} al guardar`;
    document.getElementById('gasto-avisar').checked = !editando;
  }

  /* ══ Diálogo de abono ════════════════════════════════════════════ */

  const dialogoAbono = document.getElementById('dialogo-abono');
  let abonoPara = null;

  function abrirAbono(idPersona) {
    const persona = personaPorId(idPersona);
    const cuenta = porCobrar().byPerson.find((p) => p.personId === idPersona);
    if (!persona || !cuenta) return;

    abonoPara = idPersona;
    document.getElementById('abono-contexto').innerHTML =
      `${escapar(persona.name)} te debe <b class="cifra">${plata(cuenta.pendingCents)}</b> en ` +
      `${cuenta.pendingItemCount} gasto${cuenta.pendingItemCount === 1 ? '' : 's'}.`;
    document.getElementById('abono-monto').value = textoDesdeCentavos(cuenta.pendingCents);
    document.getElementById('abono-fecha').value = hoyDia();

    refrescarAbono();
    dialogoAbono.showModal();
  }

  function refrescarAbono() {
    const cuenta = porCobrar().byPerson.find((p) => p.personId === abonoPara);
    if (!cuenta) return;

    const monto = centavosDesdeTexto(document.getElementById('abono-monto').value);
    const propuesta = M.proposeSettlementAllocation(monto, cuenta.items);
    const caja = document.getElementById('abono-reparto');

    if (propuesta.allocations.length === 0 && propuesta.unallocatedCents === 0) {
      caja.innerHTML = '';
      return;
    }

    caja.innerHTML = `
      <span class="campo__etiqueta">Se aplica así, del más viejo al más nuevo</span>
      ${propuesta.allocations
        .map((asignacion) => {
          const item = cuenta.items.find((i) => i.splitId === asignacion.splitId);
          return `
            <div class="deuda">
              <span class="deuda__que">${escapar(nombreDelGasto(item?.expenseId, 'Gasto'))}
                · ${escapar(nombreDia(diaDeIso(item?.occurredAt ?? ahora())))}</span>
              <span class="deuda__cuanto">${plata(asignacion.amountCents)}</span>
            </div>`;
        })
        .join('')}
      ${
        propuesta.unallocatedCents > 0
          ? `<p class="pista">Sobran ${plata(propuesta.unallocatedCents)}: quedan como saldo a favor.</p>`
          : ''
      }`;
  }

  /* ══ Diálogo de fijo ═════════════════════════════════════════════ */

  const dialogoFijo = document.getElementById('dialogo-fijo');
  let fijoEditando = null;

  function abrirFijo(idFijo) {
    const fijo = idFijo ? datos.fijos.find((f) => f.id === idFijo) : null;
    fijoEditando = fijo?.id ?? null;

    document.getElementById('titulo-fijo').textContent = fijo ? 'Editar gasto fijo' : 'Nuevo gasto fijo';
    document.getElementById('fijo-nombre').value = fijo?.name ?? '';
    document.getElementById('fijo-monto').value = textoDesdeCentavos(fijo?.amountCents ?? 0);
    document.getElementById('fijo-dia').value = fijo?.dayOfMonth ?? 1;
    document.getElementById('fijo-variable').checked = fijo?.isVariable ?? false;
    document.getElementById('fijo-eliminar').hidden = !fijo;

    const selector = document.getElementById('fijo-categoria');
    const disponibles = categoriasActivas();
    const actual = categoriaPorId(fijo?.categoryId);
    if (actual?.isArchived) disponibles.push(actual);

    selector.innerHTML = disponibles
      .map((c) => `<option value="${c.id}">${escapar(c.name)}</option>`)
      .join('');
    selector.value = fijo?.categoryId ?? disponibles[0]?.id ?? '';

    dialogoFijo.showModal();
  }

  /* ══ Diálogo de categoría ════════════════════════════════════════ */

  const dialogoCategoria = document.getElementById('dialogo-categoria');
  let categoriaEditando = null;
  let colorElegido = PALETA[0];

  /** Propone el primer color de la paleta que nadie esté usando. */
  function colorLibre() {
    const usados = new Set(datos.categorias.map((c) => c.color));
    return (
      PALETA.find((color) => !usados.has(color)) ?? PALETA[datos.categorias.length % PALETA.length]
    );
  }

  function abrirCategoria(idCat) {
    const categoria = idCat ? categoriaPorId(idCat) : null;
    categoriaEditando = categoria?.id ?? null;
    colorElegido = categoria?.color ?? colorLibre();

    document.getElementById('titulo-categoria').textContent = categoria
      ? 'Editar categoría'
      : 'Nueva categoría';
    document.getElementById('categoria-nombre').value = categoria?.name ?? '';
    document.getElementById('categoria-eliminar').hidden = !categoria;

    pintarColores();
    dialogoCategoria.showModal();
    setTimeout(() => document.getElementById('categoria-nombre').focus(), 40);
  }

  function pintarColores() {
    document.getElementById('categoria-colores').innerHTML = PALETA.map(
      (color) => `
        <button type="button" class="color" data-color="${color}" style="background:${color}"
                aria-pressed="${color === colorElegido}" aria-label="Color ${color}"></button>`,
    ).join('');
  }

  /**
   * Quitar una categoría con gastos borraría historial, así que solo se guarda.
   * Si nunca se usó, se elimina de verdad junto con sus topes.
   */
  function quitarCategoria(idCat) {
    const categoria = categoriaPorId(idCat);
    if (!categoria) return;

    if (categoriasActivas().length === 1) {
      avisar('Necesitas al menos una categoría.');
      return;
    }

    if (categoriaEnUso(idCat)) {
      const seguir = confirm(
        `"${categoria.name}" tiene gastos registrados. La guardo para no perder el historial y ` +
          `deja de aparecer al registrar. ¿Sigo?`,
      );
      if (!seguir) return;
      mutar((d) => {
        const objetivo = d.categorias.find((c) => c.id === idCat);
        if (objetivo) objetivo.isArchived = true;
      });
      avisar('Categoría guardada');
      return;
    }

    if (!confirm(`¿Eliminar "${categoria.name}"?`)) return;
    mutar((d) => {
      d.categorias = d.categorias.filter((c) => c.id !== idCat);
      for (const presu of Object.values(d.presupuestos)) delete presu.limites?.[idCat];
    });
    avisar('Categoría eliminada');
  }

  /* ══ Avisarle a la otra persona ══════════════════════════════════
   * Registrar que alguien te debe una parte no le sirve de nada a esa persona:
   * ella tambien esta llevando sus cuentas, y esa plata que va a salir de su
   * bolsillo no aparece en ninguna parte hasta que se la gasta.
   *
   * El aviso viaja como un enlace por WhatsApp, no como una notificacion. Es a
   * proposito: no hay cuentas que enlazar ni permisos que pedir, llega igual en
   * iPhone y en Android, y quien lo recibe decide en su propia app si lo agrega.
   * Lo que va dentro del enlace es solo ese gasto, nunca el resto de tus datos.
   *
   * Los datos viajan en el fragmento (detras del `#`), que el navegador nunca
   * manda al servidor: la plata de nadie termina en un registro de accesos.
   */

  const MARCA_ENLACE = 'compartido';

  const aClave = (texto) => {
    const bytes = new TextEncoder().encode(texto);
    let binario = '';
    for (const byte of bytes) binario += String.fromCharCode(byte);
    // base64 de toda la vida, pero apto para una URL: sin `+`, `/` ni relleno.
    return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const deClave = (clave) => {
    const base = clave.replace(/-/g, '+').replace(/_/g, '/');
    const binario = atob(base + '='.repeat((4 - (base.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
  };

  /** Todo lo que la otra persona necesita saber de su parte, y nada más. */
  function avisoDeReparto(idReparto) {
    const reparto = datos.repartos.find((r) => r.id === idReparto);
    const gasto = reparto ? datos.gastos.find((g) => g.id === reparto.expenseId) : null;
    if (!reparto || !gasto) return null;

    const quien = almacen.quienSoy();
    const deudor = personaPorId(reparto.personId);
    const carga = {
      v: 1,
      i: reparto.id,
      de: (quien?.nombre ?? '').trim().slice(0, 40),
      dc: quien?.correo ? normalizarCorreo(quien.correo).slice(0, 80) : '',
      pe: deudor?.email ? normalizarCorreo(deudor.email).slice(0, 80) : '',
      q: String(nombreDelGasto(gasto.id, nombreCategoria(gasto.categoryId))).slice(0, 60),
      // El nombre de la categoría, no su identificador: cada cuenta tiene los
      // suyos, pero las de fábrica se llaman igual en las dos.
      k: String(categoriaPorId(gasto.categoryId)?.name ?? '').slice(0, 30),
      c: reparto.amountCents,
      t: gasto.amountTotalCents,
      d: diaDeIso(gasto.occurredAt),
    };

    const enlace = `${location.href.split('#')[0]}#${MARCA_ENLACE}=${aClave(JSON.stringify(carga))}`;
    const cuando = nombreDia(carga.d).toLowerCase();

    // En primera persona porque lo manda una persona, no la app. El nombre va
    // dentro del enlace, para que al otro lado se sepa a quién se le debe.
    const texto =
      `Te comparto un gasto: ${carga.q}, ${cuando}. Te toca ${plata(carga.c)} de ${plata(carga.t)}.\n\n` +
      `Ábrelo aquí y decides si lo agregas a tus gastos: ${enlace}`;

    return { texto, persona: personaPorId(reparto.personId), idReparto: reparto.id };
  }

  const dialogoAvisar = document.getElementById('dialogo-avisar');
  let avisoPendiente = null;
  let colaAvisos = null;

  function marcarRepartoAvisado(idReparto) {
    mutar((d) => {
      const reparto = d.repartos.find((r) => r.id === idReparto);
      if (reparto) reparto.notifiedAt = ahora();
    });
  }

  function avisoCompletadoCola() {
    avisoPendiente = null;
    dialogoAvisar.close();
    if (!colaAvisos?.length) {
      colaAvisos = null;
      return;
    }
    colaAvisos.shift();
    if (colaAvisos.length > 0) {
      setTimeout(() => abrirAviso(colaAvisos[0]), 60);
    } else {
      colaAvisos = null;
    }
  }

  function encolarAvisos(ids) {
    colaAvisos = ids.filter((idReparto) => !datos.repartos.find((r) => r.id === idReparto)?.notifiedAt);
    if (colaAvisos.length === 0) {
      colaAvisos = null;
      return;
    }
    abrirAviso(colaAvisos[0]);
  }

  /** En el celular hay que compartir; en el escritorio, copiar y pegar. */
  const sePuedeCompartir = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  function abrirAviso(idReparto, esRecordatorio = false) {
    const aviso = avisoDeReparto(idReparto);
    if (!aviso) return;

    const reparto = datos.repartos.find((r) => r.id === idReparto);
    const esRecordar = esRecordatorio || Boolean(reparto?.notifiedAt);
    avisoPendiente = { ...aviso, esRecordar };
    const nombre = aviso.persona?.name ?? 'esa persona';

    document.getElementById('titulo-avisar').textContent = esRecordar
      ? `Recordarle a ${nombre}`
      : `Avisarle a ${nombre}`;
    document.getElementById('avisar-explicacion').textContent = esRecordar
      ? `Ya le avisaste${reparto?.notifiedAt ? ` el ${fechaAvisoCorta(reparto.notifiedAt)}` : ''}. ` +
        `Si no ha abierto el enlace, puedes enviarle el mensaje otra vez.`
      : `${nombre} abre el enlace, ve su parte y decide si la agrega a sus gastos como una ` +
        `deuda contigo. Del resto de tus cuentas no ve nada.`;
    document.getElementById('avisar-mensaje').textContent = aviso.texto;
    document.getElementById('avisar-enviar').textContent = sePuedeCompartir()
      ? esRecordar
        ? 'Volver a compartir'
        : 'Compartir'
      : 'Copiar mensaje';

    dialogoAvisar.showModal();
  }

  async function enviarAviso() {
    if (!avisoPendiente) return;
    const texto = avisoPendiente.texto;
    const idReparto = avisoPendiente.idReparto;
    const esRecordar = avisoPendiente.esRecordar;

    // El enlace va dentro del texto y no como `url` aparte porque hay apps que
    // se quedan con uno de los dos campos y tiran el otro.
    if (sePuedeCompartir()) {
      try {
        await navigator.share({ text: texto });
        marcarRepartoAvisado(idReparto);
        avisoCompletadoCola();
        if (esRecordar) avisar('Recordatorio enviado');
        return;
      } catch (error) {
        // Cerrar la hoja de compartir no es un fallo del que haya que avisar.
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(texto);
      marcarRepartoAvisado(idReparto);
      avisoCompletadoCola();
      avisar(esRecordar ? 'Recordatorio copiado: pégalo en WhatsApp.' : 'Mensaje copiado: pégalo en WhatsApp.');
    } catch {
      avisar('No se pudo copiar. Selecciona el mensaje y cópialo a mano.');
    }
  }

  /* ══ Recibir la parte que te compartieron ════════════════════════ */

  const dialogoRecibido = document.getElementById('dialogo-recibido');
  let recibido = null;
  let categoriaRecibido = null;

  function leerEnlace() {
    const marca = location.hash.match(new RegExp(`^#${MARCA_ENLACE}=(.+)$`));
    if (!marca) return null;

    try {
      const carga = JSON.parse(deClave(marca[1]));
      const monto = Number(carga?.c);
      if (!Number.isInteger(monto) || monto <= 0) return null;

      return {
        i: typeof carga.i === 'string' ? carga.i.slice(0, 40) : '',
        de: typeof carga.de === 'string' ? carga.de.slice(0, 40).trim() : '',
        dc: typeof carga.dc === 'string' ? normalizarCorreo(carga.dc).slice(0, 80) : '',
        pe: typeof carga.pe === 'string' ? normalizarCorreo(carga.pe).slice(0, 80) : '',
        q: typeof carga.q === 'string' ? carga.q.slice(0, 60).trim() : '',
        k: typeof carga.k === 'string' ? carga.k.slice(0, 30).trim() : '',
        c: monto,
        t: Number.isInteger(carga.t) && carga.t > 0 ? carga.t : monto,
        d: /^\d{4}-\d{2}-\d{2}$/.test(carga.d) ? carga.d : hoyDia(),
      };
    } catch {
      return null;
    }
  }

  /** Que recargar la página no vuelva a preguntar por algo ya resuelto. */
  const olvidarEnlace = () => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  };

  function abrirRecibido(carga) {
    recibido = carga;

    const sugerida = carga.k
      ? categoriasActivas().find((c) => c.name.toLowerCase() === carga.k.toLowerCase())
      : null;
    categoriaRecibido = sugerida?.id ?? categoriasActivas()[0]?.id ?? null;

    const quien = carga.de || 'Alguien';
    document.getElementById('titulo-recibido').textContent = `${quien} te compartió un gasto`;
    document.getElementById('recibido-resumen').innerHTML =
      `<b>${escapar(carga.q || 'Un gasto')}</b> · ${escapar(nombreDia(carga.d))}<br />` +
      `Tu parte es <b class="cifra">${plata(carga.c)}</b>` +
      (carga.t > carga.c ? ` de ${plata(carga.t)}` : '');
    document.getElementById('recibido-explicacion').textContent =
      `Si lo agregas, esos ${plata(carga.c)} entran en tu presupuesto de este mes y queda ` +
      `apuntado que se los debes a ${quien}.`;

    pintarCategoriasRecibido();
    dialogoRecibido.showModal();
  }

  function pintarCategoriasRecibido() {
    document.getElementById('recibido-categorias').innerHTML = categoriasActivas()
      .map(
        (c) => `
        <button type="button" class="ficha-categoria" data-categoria-recibido="${c.id}"
                aria-pressed="${c.id === categoriaRecibido}">
          <i class="categoria__mecha" style="background:${c.color}"></i>
          <span>${escapar(c.name)}</span>
        </button>`,
      )
      .join('');
  }

  /** Gasto + deuda cuando alguien pagó por ti: compartido o anotado a mano. */
  const SUFIJO_GASTO_DEUDA = '-gasto';

  function idDeudaLigada(idGasto) {
    return idGasto.endsWith(SUFIJO_GASTO_DEUDA)
      ? idGasto.slice(0, -SUFIJO_GASTO_DEUDA.length)
      : null;
  }

  function registrarDeudaConGasto(
    d,
    { idDeuda, personId, personName, description, amountCents, day, categoryId, gastoDescription, settledAt },
  ) {
    const idGasto = `${idDeuda}${SUFIJO_GASTO_DEUDA}`;
    const etiqueta = description.trim() || 'Un gasto';

    const gasto = {
      id: idGasto,
      accountId: null,
      categoryId,
      status: 'confirmed',
      source: 'manual',
      amountTotalCents: amountCents,
      myShareCents: amountCents,
      currency: 'COP',
      merchantRaw: etiqueta,
      merchantNormalized: etiqueta.toUpperCase(),
      description: gastoDescription ?? `Le debo a ${personName}: ${etiqueta}`,
      occurredAt: isoDeDia(day),
      confirmedAt: ahora(),
      createdAt: ahora(),
      updatedAt: ahora(),
      deletedAt: null,
    };

    const deuda = {
      id: idDeuda,
      personId,
      amountCents,
      description: etiqueta,
      occurredAt: isoDeDia(day),
      settledAt: settledAt ?? null,
    };

    const yaEstaba = d.gastos.findIndex((g) => g.id === idGasto);
    if (yaEstaba >= 0) {
      const previo = d.gastos[yaEstaba];
      d.gastos[yaEstaba] = {
        ...gasto,
        createdAt: previo.createdAt,
        confirmedAt: previo.confirmedAt ?? gasto.confirmedAt,
        description: gastoDescription ?? previo.description ?? gasto.description,
      };
    } else {
      d.gastos.push(gasto);
    }

    const previa = d.deudas.findIndex((x) => x.id === idDeuda);
    if (previa >= 0) d.deudas[previa] = deuda;
    else d.deudas.push(deuda);
  }

  function aceptarRecibido() {
    const carga = recibido;
    if (!carga) return;

    const nombre = carga.de || 'Quien te compartió';

    // Los identificadores salen del enlace, así que abrirlo dos veces reescribe
    // las mismas dos filas en vez de duplicar el gasto y la deuda.
    const idDeuda = carga.i ? `compartido-${carga.i}` : id();

    // Que se vea dónde quedó: es la pantalla que ahora dice que le debes.
    vista = 'personas';

    mutar((d) => {
      let persona = M.matchPersonForSharedExpense(d.personas, {
        correo: carga.dc,
        nombre,
      });
      if (persona) {
        persona = M.enrichPersonEmail(persona, carga.dc);
        const indice = d.personas.findIndex((p) => p.id === persona.id);
        if (indice >= 0) d.personas[indice] = persona;
      } else {
        persona = {
          id: id(),
          name: nombre,
          email: carga.dc || null,
        };
        d.personas.push(persona);
      }

      registrarDeudaConGasto(d, {
        idDeuda,
        personId: persona.id,
        personName: persona.name,
        description: carga.q || '',
        amountCents: carga.c,
        day: carga.d,
        categoryId: categoriaRecibido,
        gastoDescription: `Compartido por ${persona.name}`,
      });
    });

    recibido = null;
    olvidarEnlace();
    dialogoRecibido.close();
    avisar(`Listo: le debes ${plata(carga.c)} a ${nombre}`);
  }

  /* ══ Correo de cuenta de una persona ═════════════════════════════ */

  const dialogoCorreoPersona = document.getElementById('dialogo-correo-persona');

  function abrirCorreoPersona(idPersona) {
    const persona = personaPorId(idPersona);
    if (!persona) return;

    correoPersonaEditando = idPersona;
    document.getElementById('titulo-correo-persona').textContent = `Correo de ${persona.name}`;
    document.getElementById('correo-persona-explicacion').textContent =
      'Si tiene cuenta en la app, pon el mismo correo: así la reconocemos cuando te comparta un gasto.';
    document.getElementById('correo-persona').value = persona.email ?? '';
    dialogoCorreoPersona.showModal();
    setTimeout(() => document.getElementById('correo-persona').focus(), 40);
  }

  function guardarCorreoPersona() {
    const persona = personaPorId(correoPersonaEditando);
    if (!persona) return false;

    const correo = document.getElementById('correo-persona').value.trim();
    mutar((d) => {
      const fila = d.personas.find((p) => p.id === persona.id);
      if (fila) fila.email = correo ? normalizarCorreo(correo) : null;
    });

    dialogoCorreoPersona.close();
    correoPersonaEditando = null;
    avisar(correo ? 'Correo guardado' : 'Correo quitado');
    return true;
  }

  /* ══ Registrar manualmente lo que le debes ═══════════════════════ */

  const dialogoDebo = document.getElementById('dialogo-debo');
  let categoriaDebo = null;
  let deudaEditando = null;

  function abrirDebo(idPersona, idDeuda = null) {
    if (datos.personas.length === 0) {
      avisar('Agrega primero a la persona');
      agregandoPersona = true;
      vista = 'personas';
      pintar();
      return;
    }

    deudaEditando = idDeuda;
    const deuda = idDeuda ? datos.deudas.find((x) => x.id === idDeuda) : null;
    const gasto = idDeuda ? datos.gastos.find((g) => g.id === `${idDeuda}${SUFIJO_GASTO_DEUDA}`) : null;

    categoriaDebo = gasto?.categoryId ?? categoriasActivas()[0]?.id ?? null;
    document.getElementById('titulo-debo').textContent = deuda ? 'Editar deuda' : 'Registrar deuda';
    document.getElementById('debo-guardar').textContent = deuda ? 'Guardar cambios' : 'Registrar';
    document.getElementById('debo-eliminar').hidden = !deuda;
    document.getElementById('debo-pista').hidden = Boolean(deuda);
    document.getElementById('debo-persona').innerHTML = datos.personas
      .map(
        (p) =>
          `<option value="${escapar(p.id)}" ${p.id === (deuda?.personId ?? idPersona) ? 'selected' : ''}>${escapar(p.name)}</option>`,
      )
      .join('');
    document.getElementById('debo-descripcion').value = deuda?.description ?? '';
    document.getElementById('debo-monto').value = deuda ? textoDesdeCentavos(deuda.amountCents) : '';
    document.getElementById('debo-fecha').value = deuda ? diaDeIso(deuda.occurredAt) : hoyDia();
    pintarCategoriasDebo();
    dialogoDebo.showModal();
    setTimeout(() => document.getElementById('debo-descripcion').focus(), 40);
  }

  function pintarCategoriasDebo() {
    document.getElementById('debo-categorias').innerHTML = categoriasActivas()
      .map(
        (c) => `
        <button type="button" class="ficha-categoria" data-categoria-debo="${c.id}"
                aria-pressed="${c.id === categoriaDebo}">
          <i class="categoria__mecha" style="background:${c.color}"></i>
          <span>${escapar(c.name)}</span>
        </button>`,
      )
      .join('');
  }

  function guardarDebo() {
    const personId = document.getElementById('debo-persona').value;
    const persona = personaPorId(personId);
    const description = document.getElementById('debo-descripcion').value.trim();
    const amountCents = centavosDesdeTexto(document.getElementById('debo-monto').value);
    const day = document.getElementById('debo-fecha').value || hoyDia();

    if (!persona) {
      avisar('Elige a quién le debes');
      return false;
    }
    if (!description) {
      avisar('Di qué fue');
      return false;
    }
    if (amountCents <= 0) {
      avisar('Ponle un monto');
      return false;
    }
    if (!categoriaDebo) {
      avisar('Elige en qué categoría lo cuentas');
      return false;
    }

    const idDeuda = deudaEditando ?? id();
    const eraEdicion = Boolean(deudaEditando);
    const settledAt = deudaEditando
      ? (datos.deudas.find((x) => x.id === deudaEditando)?.settledAt ?? null)
      : null;
    const gastoLigado = deudaEditando
      ? datos.gastos.find((g) => g.id === `${deudaEditando}${SUFIJO_GASTO_DEUDA}`)
      : null;
    vista = 'personas';

    mutar((d) => {
      registrarDeudaConGasto(d, {
        idDeuda,
        personId: persona.id,
        personName: persona.name,
        description,
        amountCents,
        day,
        categoryId: categoriaDebo,
        settledAt,
        gastoDescription: gastoLigado?.description,
      });
    });

    dialogoDebo.close();
    deudaEditando = null;
    avisar(eraEdicion ? 'Deuda actualizada' : `Listo: le debes ${plata(amountCents)} a ${persona.name}`);
    return true;
  }

  function borrarDeuda(idDeuda) {
    if (!confirm('¿Quitar este registro de deuda?')) return;
    mutar((d) => {
      d.deudas = d.deudas.filter((x) => x.id !== idDeuda);
      const idGasto = `${idDeuda}${SUFIJO_GASTO_DEUDA}`;
      const gasto = d.gastos.find((g) => g.id === idGasto);
      if (gasto) {
        gasto.deletedAt = ahora();
        gasto.updatedAt = ahora();
      }
    });
    avisar('Deuda quitada');
  }

  function quitarReparto(idSplit) {
    if (datos.asignaciones.some((a) => a.splitId === idSplit)) {
      avisar('Ya tiene abonos aplicados; ajústalo desde el gasto.');
      return;
    }
    if (!confirm('¿Quitar lo que te debe de este gasto?')) return;
    mutar((d) => {
      d.repartos = d.repartos.filter((r) => r.id !== idSplit);
    });
    avisar('Deuda quitada');
  }

  /* ══ Acciones sobre los datos ════════════════════════════════════ */

  function guardarGasto() {
    const resultado = repartoResuelto();
    if (resultado.error) {
      avisar(resultado.error);
      return false;
    }
    if (resultado.total <= 0) {
      avisar('Ponle un monto al gasto.');
      return false;
    }

    const comercio = document.getElementById('gasto-comercio').value.trim();
    const fecha = document.getElementById('gasto-fecha').value || hoyDia();
    const cuenta = document.getElementById('gasto-cuenta').value || null;
    const editando = borrador.id;
    const repartosGuardados = [];
    const wrapAvisar = document.getElementById('gasto-avisar-wrap');
    const quiereAvisar = !wrapAvisar.hidden && document.getElementById('gasto-avisar').checked;

    mutar((d) => {
      const idGasto = borrador.id ?? id();
      const repartosPrevios = borrador.id ? d.repartos.filter((r) => r.expenseId === idGasto) : [];

      if (borrador.id) {
        const gasto = d.gastos.find((g) => g.id === borrador.id);
        Object.assign(gasto, {
          accountId: cuenta,
          categoryId: borrador.categoriaId,
          amountTotalCents: resultado.total,
          myShareCents: resultado.myShareCents,
          merchantRaw: comercio || null,
          merchantNormalized: comercio ? comercio.toUpperCase() : null,
          occurredAt: isoDeDia(fecha),
          updatedAt: ahora(),
        });
        d.repartos = d.repartos.filter((r) => r.expenseId !== idGasto);

        const idDeuda = idDeudaLigada(idGasto);
        if (idDeuda) {
          const deuda = d.deudas.find((x) => x.id === idDeuda);
          if (deuda) {
            deuda.amountCents = resultado.myShareCents;
            deuda.description = comercio || deuda.description;
            deuda.occurredAt = isoDeDia(fecha);
          }
        }
      } else {
        d.gastos.push({
          id: idGasto,
          accountId: cuenta,
          categoryId: borrador.categoriaId,
          status: 'confirmed',
          source: 'manual',
          amountTotalCents: resultado.total,
          myShareCents: resultado.myShareCents,
          currency: 'COP',
          merchantRaw: comercio || null,
          merchantNormalized: comercio ? comercio.toUpperCase() : null,
          description: null,
          occurredAt: isoDeDia(fecha),
          confirmedAt: ahora(),
          createdAt: ahora(),
          updatedAt: ahora(),
          deletedAt: null,
        });
      }

      for (const parte of resultado.splits) {
        if (parte.amountCents <= 0) continue;
        const previo = repartosPrevios.find((r) => r.personId === parte.personId);
        const idReparto = previo?.id ?? id();
        const mismoMonto = previo?.amountCents === parte.amountCents;
        repartosGuardados.push({ id: idReparto, personId: parte.personId });
        d.repartos.push({
          id: idReparto,
          expenseId: idGasto,
          personId: parte.personId,
          amountCents: parte.amountCents,
          notifiedAt: previo && mismoMonto ? (previo.notifiedAt ?? null) : null,
        });
      }
    });

    avisar(editando ? 'Gasto actualizado' : 'Gasto registrado');

    if (quiereAvisar) {
      const cola = repartosGuardados
        .filter((reparto) => personaUsaApp(reparto.personId))
        .map((reparto) => reparto.id)
        .filter((idReparto) => !datos.repartos.find((r) => r.id === idReparto)?.notifiedAt);
      if (cola.length) {
        setTimeout(() => encolarAvisos(cola), 60);
      }
    }

    return true;
  }

  function eliminarGasto(idGasto) {
    mutar((d) => {
      const gasto = d.gastos.find((g) => g.id === idGasto);
      if (gasto) {
        gasto.deletedAt = ahora();
        gasto.updatedAt = ahora();
      }
      const instancia = d.instancias.find((i) => i.expenseId === idGasto);
      if (instancia) {
        instancia.status = 'planned';
        instancia.expenseId = null;
      }
      const idDeuda = idDeudaLigada(idGasto);
      if (idDeuda) {
        d.deudas = d.deudas.filter((deuda) => deuda.id !== idDeuda);
      }
    });
    avisar('Gasto eliminado');
  }

  function pagarFijo(idInstancia, centavos) {
    mutar((d) => {
      const instancia = d.instancias.find((i) => i.id === idInstancia);
      if (!instancia) return;
      const fijo = d.fijos.find((f) => f.id === instancia.recurringId);
      const idGasto = id();

      const { year, month } = M.splitMonthKey(instancia.month);
      const dia = M.clampDayToMonth(instancia.month, fijo?.dayOfMonth ?? 1);
      const fecha = `${year}-${String(month).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

      d.gastos.push({
        id: idGasto,
        accountId: null,
        categoryId: fijo?.categoryId ?? null,
        status: 'confirmed',
        source: 'recurring',
        amountTotalCents: centavos,
        myShareCents: centavos,
        currency: 'COP',
        merchantRaw: fijo?.name ?? 'Gasto fijo',
        merchantNormalized: (fijo?.name ?? 'GASTO FIJO').toUpperCase(),
        description: null,
        occurredAt: isoDeDia(fecha),
        confirmedAt: ahora(),
        recurringExpenseId: fijo?.id ?? null,
        createdAt: ahora(),
        updatedAt: ahora(),
        deletedAt: null,
      });

      instancia.status = 'posted';
      instancia.plannedCents = centavos;
      instancia.expenseId = idGasto;
    });
    avisar('Fijo pagado');
  }

  /* ══ Datos de ejemplo ════════════════════════════════════════════ */

  function llenarEjemplo() {
    const mesActual = M.monthKeyOf(new Date(), OFFSET);
    const { year, month } = M.splitMonthKey(mesActual);
    const dia = (n) =>
      `${year}-${String(month).padStart(2, '0')}-${String(M.clampDayToMonth(mesActual, n)).padStart(2, '0')}`;

    mutar((d) => {
      const ana = { id: id(), name: 'Ana' };
      const carlos = { id: id(), name: 'Carlos' };
      d.personas.push(ana, carlos);

      d.presupuestos[mesActual] = {
        totalCents: 350000000,
        limites: { 'salidas-comer': 60000000, mercado: 80000000, transporte: 25000000 },
      };

      d.fijos.push(
        {
          id: id(),
          name: 'Arriendo',
          categoryId: 'arriendo',
          amountCents: 150000000,
          dayOfMonth: 1,
          isVariable: false,
          isArchived: false,
        },
        {
          id: id(),
          name: 'Internet y luz',
          categoryId: 'servicios',
          amountCents: 22000000,
          dayOfMonth: 15,
          isVariable: true,
          isArchived: false,
        },
      );

      const nuevo = (centavos, categoria, comercio, cuando, partes) => {
        const idGasto = id();
        const total = centavos;
        const deOtros = (partes ?? []).reduce((s, p) => s + p.centavos, 0);

        d.gastos.push({
          id: idGasto,
          accountId: 'debito',
          categoryId: categoria,
          status: 'confirmed',
          source: 'manual',
          amountTotalCents: total,
          myShareCents: total - deOtros,
          currency: 'COP',
          merchantRaw: comercio,
          merchantNormalized: comercio.toUpperCase(),
          description: null,
          occurredAt: isoDeDia(cuando),
          confirmedAt: ahora(),
          createdAt: ahora(),
          updatedAt: ahora(),
          deletedAt: null,
        });

        for (const parte of partes ?? []) {
          d.repartos.push({
            id: id(),
            expenseId: idGasto,
            personId: parte.persona,
            amountCents: parte.centavos,
          });
        }
      };

      nuevo(18500000, 'mercado', 'Éxito', dia(2), [{ persona: ana.id, centavos: 9250000 }]);
      nuevo(4200000, 'salidas-comer', 'Crepes & Waffles', dia(3));
      nuevo(1200000, 'transporte', 'Uber', dia(4));
      nuevo(9800000, 'salidas-comer', 'Andrés Carne de Res', dia(6), [
        { persona: ana.id, centavos: 3266700 },
        { persona: carlos.id, centavos: 3266700 },
      ]);
      nuevo(3500000, 'gasolina', 'Terpel', dia(7));
      nuevo(2200000, 'entretenimiento', 'Cine Colombia', dia(9), [
        { persona: carlos.id, centavos: 1100000 },
      ]);
      nuevo(15600000, 'mercado', 'D1', dia(11));
      nuevo(890000, 'transporte', 'Uber', dia(12));
      nuevo(6700000, 'salidas-comer', 'El Cielo', dia(14));
      nuevo(4900000, 'ropa', 'Zara', dia(16));
    });

    avisar('Listo, ya hay con qué jugar');
  }

  /* ══ Cuenta ══════════════════════════════════════════════════════ */

  /**
   * El bloque de la cuenta solo aparece si hay sesion. Abierto como archivo
   * suelto o en la vista previa del diseño no hay a quien nombrar, y una
   * ficha vacia con un boton de salir que no lleva a ningun lado confunde.
   */
  function pintarCuenta() {
    const quien = almacen.quienSoy();
    const caja = document.getElementById('cuenta-actual');
    caja.hidden = !quien;

    // Los datos de ejemplo se suman a lo que ya haya y pisan el presupuesto
    // del mes. Es util para curiosear el archivo suelto, y una forma de
    // arruinarse las cuentas de verdad, asi que no existe si hay cuenta.
    document.getElementById('datos-ejemplo').hidden = almacen.conCuenta;

    document.getElementById('datos-explicacion').textContent = quien
      ? 'Todo se guarda en tu cuenta y este navegador conserva una copia, así que la app ' +
        'funciona sin señal y sube los cambios cuando vuelve.'
      : 'Todo vive en este navegador. Descarga una copia antes de cambiar de equipo o de ' +
        'limpiar el historial.';

    if (!quien) return;

    document.getElementById('cuenta-inicial').textContent = iniciales(quien.nombre || quien.correo);
    document.getElementById('cuenta-nombre').textContent = quien.nombre || quien.correo;
  }

  async function salir() {
    try {
      await fetch('/api/cuenta/salir', { method: 'POST' });
    } catch (error) {
      console.warn('No se pudo cerrar la sesión en el servidor', error);
    }
    // La copia local es de esta cuenta: dejarla seria mostrarsela a quien
    // entre despues en el mismo navegador.
    almacen.limpiar();
    location.href = '/entrar';
  }

  /* ══ Eventos ═════════════════════════════════════════════════════ */

  document.addEventListener('click', (evento) => {
    const objetivo = evento.target;

    const paso = objetivo.closest('[data-mes]');
    if (paso) {
      mes = M.addMonths(mes, Number(paso.dataset.mes));
      pintar();
      return;
    }

    const pestana = objetivo.closest('.pestana');
    if (pestana) {
      if (pestana.dataset.vista !== 'personas') {
        agregandoPersona = false;
        correoPersonaEditando = null;
        dialogoCorreoPersona.close();
      }
      vista = pestana.dataset.vista;
      pintar();
      return;
    }

    const ir = objetivo.closest('[data-ir]');
    if (ir) {
      if (ir.dataset.ir !== 'personas') {
        agregandoPersona = false;
        correoPersonaEditando = null;
        dialogoCorreoPersona.close();
      }
      vista = ir.dataset.ir;
      pintar();
      return;
    }

    if (objetivo.closest('[data-mostrar-nueva-persona]')) {
      agregandoPersona = true;
      pintar();
      setTimeout(() => document.querySelector('[data-nueva-persona] [name="nombre"]')?.focus(), 40);
      return;
    }

    if (objetivo.closest('[data-cancelar-nueva-persona]')) {
      agregandoPersona = false;
      pintar();
      return;
    }

    const editarCorreoPersona = objetivo.closest('[data-editar-correo-persona]');
    if (editarCorreoPersona) {
      abrirCorreoPersona(editarCorreoPersona.dataset.editarCorreoPersona);
      return;
    }

    const abrir = objetivo.closest('[data-abrir]');
    if (abrir) {
      if (abrir.dataset.abrir === 'gasto') abrirGasto(null);
      if (abrir.dataset.abrir === 'fijo') abrirFijo(null);
      if (abrir.dataset.abrir === 'categoria') abrirCategoria(null);
      if (abrir.dataset.abrir === 'datos') {
        pintarCuenta();
        document.getElementById('dialogo-datos').showModal();
      }
      return;
    }

    if (objetivo.closest('#cuenta-salir')) {
      salir();
      return;
    }

    const cerrar = objetivo.closest('[data-cerrar]');
    if (cerrar) {
      cerrar.closest('dialog')?.close();
      return;
    }

    const verGasto = objetivo.closest('[data-gasto]');
    if (verGasto) {
      const gasto = datos.gastos.find((g) => g.id === verGasto.dataset.gasto);
      if (gasto) abrirGasto(gasto);
      return;
    }

    const verDeuda = objetivo.closest('[data-deuda]');
    if (verDeuda) {
      abrirDebo(null, verDeuda.dataset.deuda);
      return;
    }

    const fichaCategoria = objetivo.closest('[data-categoria]');
    if (fichaCategoria) {
      borrador.categoriaId = fichaCategoria.dataset.categoria;
      pintarCategoriasForma();
      return;
    }

    const fichaPersona = objetivo.closest('[data-persona]');
    if (fichaPersona) {
      const idPersona = fichaPersona.dataset.persona;
      const puesta = borrador.personas.indexOf(idPersona);
      if (puesta >= 0) borrador.personas.splice(puesta, 1);
      else borrador.personas.push(idPersona);
      pintarPersonasForma();
      refrescarReparto();
      return;
    }

    if (objetivo.closest('[data-categoria-nueva]')) {
      const nombre = prompt('¿Cómo se llama la categoría?');
      if (!nombre || !nombre.trim()) return;
      const nueva = { id: id(), name: nombre.trim(), color: colorLibre(), isArchived: false };
      datos.categorias.push(nueva);
      almacen.guardar(datos);
      borrador.categoriaId = nueva.id;
      pintarCategoriasForma();
      return;
    }

    if (objetivo.closest('[data-persona-nueva]')) {
      const nombre = prompt('¿Cómo se llama?');
      if (!nombre || !nombre.trim()) return;
      const nueva = { id: id(), name: nombre.trim() };
      datos.personas.push(nueva);
      almacen.guardar(datos);
      borrador.personas.push(nueva.id);
      pintarPersonasForma();
      refrescarReparto();
      return;
    }

    const segmento = objetivo.closest('#reparto-modo .segmento');
    if (segmento) {
      borrador.modo = segmento.dataset.modo;
      refrescarReparto();
      return;
    }

    if (objetivo.closest('#gasto-eliminar')) {
      if (!borrador.id) return;
      if (!confirm('¿Eliminar este gasto?')) return;
      eliminarGasto(borrador.id);
      dialogoGasto.close();
      return;
    }

    const abonar = objetivo.closest('[data-abonar]');
    if (abonar) {
      abrirAbono(abonar.dataset.abonar);
      return;
    }

    const avisarle = objetivo.closest('[data-avisar]');
    if (avisarle) {
      abrirAviso(avisarle.dataset.avisar);
      return;
    }

    const recordar = objetivo.closest('[data-recordar]');
    if (recordar) {
      abrirAviso(recordar.dataset.recordar, true);
      return;
    }

    if (objetivo.closest('#avisar-enviar')) {
      enviarAviso();
      return;
    }

    const categoriaRecibida = objetivo.closest('[data-categoria-recibido]');
    if (categoriaRecibida) {
      categoriaRecibido = categoriaRecibida.dataset.categoriaRecibido;
      pintarCategoriasRecibido();
      return;
    }

    if (objetivo.closest('#recibido-agregar')) {
      aceptarRecibido();
      return;
    }

    if (objetivo.closest('#recibido-descartar')) {
      recibido = null;
      olvidarEnlace();
      dialogoRecibido.close();
      return;
    }

    if (objetivo.closest('[data-abrir-debo]')) {
      abrirDebo(null);
      return;
    }

    if (objetivo.closest('#debo-eliminar')) {
      if (!deudaEditando) return;
      borrarDeuda(deudaEditando);
      dialogoDebo.close();
      return;
    }

    const deboPersona = objetivo.closest('[data-debo-persona]');
    if (deboPersona) {
      abrirDebo(deboPersona.dataset.deboPersona);
      return;
    }

    const categoriaDeboBtn = objetivo.closest('[data-categoria-debo]');
    if (categoriaDeboBtn) {
      categoriaDebo = categoriaDeboBtn.dataset.categoriaDebo;
      pintarCategoriasDebo();
      return;
    }

    const pague = objetivo.closest('[data-pague]');
    if (pague) {
      const idDeuda = pague.dataset.pague;
      mutar((d) => {
        const deuda = d.deudas.find((x) => x.id === idDeuda);
        if (deuda) deuda.settledAt = deuda.settledAt ? null : ahora();
      });
      return;
    }

    const borrarPersona = objetivo.closest('[data-borrar-persona]');
    if (borrarPersona) {
      const idPersona = borrarPersona.dataset.borrarPersona;
      mutar((d) => {
        d.personas = d.personas.filter((p) => p.id !== idPersona);
      });
      return;
    }

    const editarCategoria = objetivo.closest('[data-editar-categoria]');
    if (editarCategoria) {
      abrirCategoria(editarCategoria.dataset.editarCategoria);
      return;
    }

    const borrarCategoria = objetivo.closest('[data-borrar-categoria]');
    if (borrarCategoria) {
      quitarCategoria(borrarCategoria.dataset.borrarCategoria);
      return;
    }

    const restaurarCategoria = objetivo.closest('[data-restaurar-categoria]');
    if (restaurarCategoria) {
      const idCat = restaurarCategoria.dataset.restaurarCategoria;
      mutar((d) => {
        const categoria = d.categorias.find((c) => c.id === idCat);
        if (categoria) categoria.isArchived = false;
      });
      avisar('Categoría restaurada');
      return;
    }

    const muestraColor = objetivo.closest('[data-color]');
    if (muestraColor) {
      colorElegido = muestraColor.dataset.color;
      pintarColores();
      return;
    }

    if (objetivo.closest('#categoria-eliminar')) {
      if (!categoriaEditando) return;
      const idCat = categoriaEditando;
      dialogoCategoria.close();
      quitarCategoria(idCat);
      return;
    }

    const editarFijo = objetivo.closest('[data-editar-fijo]');
    if (editarFijo) {
      abrirFijo(editarFijo.dataset.editarFijo);
      return;
    }

    const pagar = objetivo.closest('[data-pagar]');
    if (pagar) {
      const entrada = document.querySelector(`[data-monto-instancia="${pagar.dataset.pagar}"]`);
      const centavos = centavosDesdeTexto(entrada?.value ?? '');
      if (centavos <= 0) {
        avisar('Ponle el monto que pagaste.');
        return;
      }
      pagarFijo(pagar.dataset.pagar, centavos);
      return;
    }

    const saltar = objetivo.closest('[data-saltar]');
    if (saltar) {
      mutar((d) => {
        const instancia = d.instancias.find((i) => i.id === saltar.dataset.saltar);
        if (instancia) instancia.status = 'skipped';
      });
      return;
    }

    if (objetivo.closest('#fijo-eliminar')) {
      if (!fijoEditando) return;
      if (!confirm('¿Eliminar este gasto fijo? Los meses ya pagados se quedan como están.')) return;
      const idFijo = fijoEditando;
      mutar((d) => {
        const fijo = d.fijos.find((f) => f.id === idFijo);
        if (fijo) fijo.isArchived = true;
        d.instancias = d.instancias.filter((i) => i.recurringId !== idFijo || i.status === 'posted');
      });
      dialogoFijo.close();
      return;
    }

    if (objetivo.closest('[data-copiar-presupuesto]')) {
      const anterior = presupuestoDe(M.addMonths(mes, -1));
      mutar((d) => {
        d.presupuestos[mes] = {
          totalCents: anterior.totalCents,
          limites: { ...(anterior.limites ?? {}) },
        };
      });
      avisar('Presupuesto copiado');
      return;
    }

    if (objetivo.closest('#datos-exportar')) {
      const enlace = document.createElement('a');
      const archivo = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
      enlace.href = URL.createObjectURL(archivo);
      enlace.download = `gastos-${hoyDia()}.json`;
      enlace.click();
      URL.revokeObjectURL(enlace.href);
      return;
    }

    if (objetivo.closest('#datos-importar')) {
      document.getElementById('datos-archivo').click();
      return;
    }

    if (objetivo.closest('#datos-ejemplo')) {
      document.getElementById('dialogo-datos').close();
      llenarEjemplo();
      return;
    }

    if (objetivo.closest('#datos-borrar')) {
      if (!confirm('Se borra todo lo registrado en este navegador. ¿Seguro?')) return;
      almacen.limpiar();
      datos = vacio();
      almacen.guardar(datos);
      document.getElementById('dialogo-datos').close();
      pintar();
      avisar('Todo borrado');
    }
  });

  document.addEventListener('input', (evento) => {
    const objetivo = evento.target;

    if (objetivo.matches('.monto__entrada')) {
      const digitos = objetivo.value.replace(/\D/g, '');
      objetivo.value = digitos ? new Intl.NumberFormat('es-CO').format(Number(digitos)) : '';
    }

    if (objetivo.id === 'gasto-monto') {
      refrescarReparto();
      return;
    }

    if (objetivo.id === 'abono-monto') {
      refrescarAbono();
      return;
    }

    const valorPersona = objetivo.closest('[data-valor-persona]');
    if (valorPersona) {
      const idPersona = valorPersona.dataset.valorPersona;
      if (borrador.modo === 'percent') {
        borrador.porcentajes[idPersona] = Number(valorPersona.value.replace(/[^\d.]/g, '')) || 0;
      } else {
        const digitos = valorPersona.value.replace(/\D/g, '');
        valorPersona.value = digitos ? new Intl.NumberFormat('es-CO').format(Number(digitos)) : '';
        borrador.montos[idPersona] = centavosDesdeTexto(valorPersona.value);
      }
      pintarResultadoReparto();
    }
  });

  document.addEventListener('change', (evento) => {
    const objetivo = evento.target;

    if (objetivo.id === 'gasto-incluirme') {
      borrador.incluirme = objetivo.checked;
      refrescarReparto();
      return;
    }

    if (objetivo.matches('[data-presupuesto-total]')) {
      const centavos = centavosDesdeTexto(objetivo.value);
      mutar((d) => {
        const actual = d.presupuestos[mes] ?? { totalCents: 0, limites: {} };
        d.presupuestos[mes] = { ...actual, totalCents: centavos };
      });
      return;
    }

    const tope = objetivo.closest('[data-tope]');
    if (tope) {
      const centavos = centavosDesdeTexto(tope.value);
      const idCategoria = tope.dataset.tope;
      mutar((d) => {
        const actual = d.presupuestos[mes] ?? { totalCents: 0, limites: {} };
        const limites = { ...(actual.limites ?? {}) };
        if (centavos > 0) limites[idCategoria] = centavos;
        else delete limites[idCategoria];
        d.presupuestos[mes] = { ...actual, limites };
      });
      return;
    }

    if (objetivo.id === 'datos-archivo') {
      const archivo = objetivo.files?.[0];
      if (!archivo) return;
      const lector = new FileReader();
      lector.onload = () => {
        try {
          datos = completar(JSON.parse(String(lector.result)));
          almacen.guardar(datos);
          document.getElementById('dialogo-datos').close();
          pintar();
          avisar('Copia cargada');
        } catch {
          avisar('Ese archivo no se pudo leer.');
        }
      };
      lector.readAsText(archivo);
    }
  });

  formaGasto.addEventListener('submit', (evento) => {
    if (!guardarGasto()) evento.preventDefault();
  });

  document.getElementById('forma-abono').addEventListener('submit', () => {
    const monto = centavosDesdeTexto(document.getElementById('abono-monto').value);
    const fecha = document.getElementById('abono-fecha').value || hoyDia();
    const cuenta = porCobrar().byPerson.find((p) => p.personId === abonoPara);
    if (!cuenta || monto <= 0) return;

    const propuesta = M.proposeSettlementAllocation(monto, cuenta.items);

    mutar((d) => {
      const idAbono = id();
      d.abonos.push({
        id: idAbono,
        personId: abonoPara,
        amountCents: monto,
        paidAt: isoDeDia(fecha),
      });
      for (const asignacion of propuesta.allocations) {
        d.asignaciones.push({
          id: id(),
          settlementId: idAbono,
          splitId: asignacion.splitId,
          amountCents: asignacion.amountCents,
        });
      }
    });

    avisar('Abono registrado');
  });

  document.getElementById('forma-categoria').addEventListener('submit', (evento) => {
    const nombre = document.getElementById('categoria-nombre').value.trim();
    if (!nombre) {
      evento.preventDefault();
      return;
    }

    const editando = categoriaEditando;
    const repetida = datos.categorias.some(
      (c) => c.id !== editando && c.name.toLowerCase() === nombre.toLowerCase(),
    );
    if (repetida) {
      evento.preventDefault();
      avisar(`Ya tienes una categoría llamada "${nombre}".`);
      return;
    }

    mutar((d) => {
      if (editando) {
        const categoria = d.categorias.find((c) => c.id === editando);
        Object.assign(categoria, { name: nombre, color: colorElegido });
      } else {
        d.categorias.push({ id: id(), name: nombre, color: colorElegido, isArchived: false });
      }
    });

    avisar(editando ? 'Categoría actualizada' : 'Categoría creada');
  });

  document.getElementById('forma-fijo').addEventListener('submit', () => {
    const nombre = document.getElementById('fijo-nombre').value.trim();
    const centavos = centavosDesdeTexto(document.getElementById('fijo-monto').value);
    const categoria = document.getElementById('fijo-categoria').value;
    const diaMes = Number(document.getElementById('fijo-dia').value) || 1;
    const variable = document.getElementById('fijo-variable').checked;
    if (!nombre || centavos <= 0) return;

    const editando = fijoEditando;

    mutar((d) => {
      if (editando) {
        const fijo = d.fijos.find((f) => f.id === editando);
        Object.assign(fijo, {
          name: nombre,
          categoryId: categoria,
          amountCents: centavos,
          dayOfMonth: diaMes,
          isVariable: variable,
        });
        // Los meses que aún no se pagan se ajustan al nuevo monto.
        for (const instancia of d.instancias) {
          if (instancia.recurringId === editando && instancia.status === 'planned') {
            instancia.plannedCents = centavos;
          }
        }
      } else {
        d.fijos.push({
          id: id(),
          name: nombre,
          categoryId: categoria,
          amountCents: centavos,
          dayOfMonth: diaMes,
          isVariable: variable,
          isArchived: false,
        });
      }
    });

    avisar(editando ? 'Fijo actualizado' : 'Fijo creado');
  });

  document.getElementById('forma-debo').addEventListener('submit', (evento) => {
    evento.preventDefault();
    guardarDebo();
  });

  dialogoDebo.addEventListener('close', () => {
    deudaEditando = null;
  });

  document.getElementById('forma-correo-persona').addEventListener('submit', (evento) => {
    evento.preventDefault();
    guardarCorreoPersona();
  });

  document.addEventListener('submit', (evento) => {
    const forma = evento.target.closest('[data-nueva-persona]');
    if (!forma) return;
    evento.preventDefault();
    const nombre = forma.elements.nombre.value.trim();
    const correo = forma.elements.correo.value.trim();
    if (!nombre) return;
    agregandoPersona = false;
    mutar((d) => {
      d.personas.push({
        id: id(),
        name: nombre,
        email: correo ? normalizarCorreo(correo) : null,
      });
    });
    avisar('Persona agregada');
  });

  /* ══ Arranque ════════════════════════════════════════════════════ */

  // Cuando el servidor manda su version de los datos, se cambia el estado
  // entero y se vuelve a pintar. Pasa al abrir y cuando hay un conflicto.
  almacen.escuchar((estado) => {
    datos = completar(estado);
    pintar();
  });

  // Se pinta ya con lo que hay en el navegador y despues se contrasta con la
  // cuenta: abrir la app tiene que ser instantaneo, con o sin senal.
  pintar();
  almacen.estrenar(datos);

  // Si se llego aqui desde un enlace compartido, lo primero es resolverlo.
  const compartido = leerEnlace();
  if (compartido) abrirRecibido(compartido);

  // Lo que hace que se pueda instalar en la pantalla de inicio y abrir sin
  // senal. No guarda datos, solo la cascara.
  if (almacen.conCuenta && 'serviceWorker' in navigator) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('No se pudo instalar el service worker', error);
      });
    });
  }
})();
