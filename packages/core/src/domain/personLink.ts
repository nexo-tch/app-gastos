export type PersonaEnlace = {
  id: string;
  name: string;
  email?: string | null;
};

export type RemitenteEnlace = {
  /** Correo de la cuenta de quien comparte el gasto. */
  correo?: string | null;
  /** Nombre con el que se ve en la app de quien comparte. */
  nombre?: string | null;
};

const normalizar = (correo: string) => correo.trim().toLowerCase();

/**
 * Encuentra la persona que ya tienes guardada para quien te compartió un gasto.
 *
 * El nombre de usuario cambia ("Ed" vs "edxa"), pero el correo de la cuenta no:
 * si lo asociaste al crear la persona, el enlace lo reconoce aunque el nombre no coincida.
 */
export function matchPersonForSharedExpense(
  personas: readonly PersonaEnlace[],
  remitente: RemitenteEnlace,
): PersonaEnlace | null {
  const correo = remitente.correo?.trim();
  if (correo) {
    const clave = normalizar(correo);
    const porCorreo = personas.find((p) => p.email && normalizar(p.email) === clave);
    if (porCorreo) return porCorreo;
  }

  const nombre = remitente.nombre?.trim();
  if (nombre) {
    const clave = nombre.toLowerCase();
    const porNombre = personas.find((p) => p.name.toLowerCase() === clave);
    if (porNombre) return porNombre;
  }

  return null;
}

/** Rellena el correo de una persona existente si el enlace lo trae y a ella le faltaba. */
export function enrichPersonEmail(
  persona: PersonaEnlace,
  remitenteCorreo?: string | null,
): PersonaEnlace {
  const correo = remitenteCorreo?.trim();
  if (!correo || persona.email) return persona;
  return { ...persona, email: normalizar(correo) };
}
