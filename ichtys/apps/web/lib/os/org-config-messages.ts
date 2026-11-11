/** Textos de la pantalla de configuración del centro. Sin dependencias: se usa en el navegador. */
const ERROR_TEXT: Record<string, string> = {
  url_required: 'Para encender el módulo hace falta la dirección del sistema.',
  url_invalid: 'La dirección tiene que empezar con https://, ser de un servidor público y no llevar usuario, clave ni parámetros (nada después de un ? o un #).',
  time_zone_invalid: 'Esa zona horaria no existe. Usá el formato América/Ciudad, por ejemplo America/Bogota.',
}

export function orgConfigError(status: number, code: unknown): string {
  if (status === 403) return 'Solo quien administra la organización puede cambiar esto.'
  if (typeof code === 'string' && ERROR_TEXT[code]) return ERROR_TEXT[code]
  return 'No se pudo guardar. Probá de nuevo.'
}
