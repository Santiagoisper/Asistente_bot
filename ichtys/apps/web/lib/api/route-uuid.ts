/**
 * El identificador que llega en una ruta, comprobado y en su forma canónica (minúsculas, como
 * lo devuelve la base). `null`: no es un UUID y no llega a la base.
 *
 * Por qué en un solo lugar: Postgres compara una columna `uuid` sin distinguir mayúsculas, pero
 * el perfil y el registro de auditoría guardan el identificador como texto y sí distinguen. Una
 * ruta que usa el identificador tal como llegó puede encontrar la fila y después no encontrar
 * lo que guardó con otra caja (hallazgo del #178). Sin dependencias.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function parseRouteUuid(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const canonical = value.toLowerCase()
  return UUID.test(canonical) ? canonical : null
}
