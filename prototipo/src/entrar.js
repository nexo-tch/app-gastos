/* eslint-disable */
(function () {
  'use strict';

  const forma = document.getElementById('forma');
  const error = document.getElementById('error');
  const enviar = document.getElementById('enviar');
  const campoNombre = document.getElementById('campo-nombre');
  const nombre = document.getElementById('nombre');
  const correo = document.getElementById('correo');
  const clave = document.getElementById('clave');
  const pistaClave = document.getElementById('pista-clave');
  const pregunta = document.getElementById('pregunta');
  const cambiar = document.getElementById('cambiar');

  // Una sola pantalla para las dos cosas. Son los mismos dos campos, y salir
  // a otra pagina para agregar uno mas no le ahorra nada a nadie.
  let creando = new URLSearchParams(location.search).has('crear');

  function pintar() {
    document.title = creando ? 'Crear cuenta · Gastos' : 'Entrar · Gastos';
    campoNombre.hidden = !creando;
    nombre.required = creando;
    pistaClave.hidden = !creando;
    clave.autocomplete = creando ? 'new-password' : 'current-password';
    enviar.textContent = creando ? 'Crear mi cuenta' : 'Entrar';
    pregunta.textContent = creando ? '¿Ya tienes cuenta?' : '¿Todavía no tienes cuenta?';
    cambiar.textContent = creando ? 'Entrar' : 'Crear una';
  }

  // `pintar` no borra el error a proposito: se llama tambien al volver de un
  // intento fallido, para devolverle su texto al boton, y si de paso limpiara
  // el aviso el motivo del fallo desapareceria antes de poder leerlo.
  const olvidarError = () => {
    error.hidden = true;
  };

  function fallar(mensaje) {
    error.textContent = mensaje;
    error.hidden = false;
  }

  cambiar.addEventListener('click', () => {
    creando = !creando;
    pintar();
    olvidarError();
    (creando ? nombre : correo).focus();
  });

  forma.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const datos = {
      correo: correo.value.trim(),
      clave: clave.value,
    };

    if (!datos.correo.includes('@')) return fallar('Escribe un correo válido.');
    if (creando) {
      datos.nombre = nombre.value.trim();
      if (!datos.nombre) return fallar('Dinos cómo te llamas.');
      if (datos.clave.length < 8) return fallar('La contraseña necesita al menos 8 caracteres.');
    } else if (!datos.clave) {
      return fallar('Falta la contraseña.');
    }

    enviar.disabled = true;
    enviar.textContent = creando ? 'Creando…' : 'Entrando…';
    olvidarError();

    try {
      const respuesta = await fetch(creando ? '/api/cuenta/registro' : '/api/cuenta/entrar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(datos),
      });

      if (respuesta.ok) {
        location.href = '/';
        return;
      }

      const cuerpo = await respuesta.json().catch(() => ({}));
      fallar(cuerpo.error ?? 'No se pudo. Inténtalo otra vez.');
    } catch {
      fallar('No hay conexión con el servidor.');
    }

    enviar.disabled = false;
    pintar();
  });

  pintar();
  (creando ? nombre : correo).focus();
})();
