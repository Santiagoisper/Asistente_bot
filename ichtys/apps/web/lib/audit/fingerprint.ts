import { createHash } from 'node:crypto'

/** Texto canónico de un valor JSON: las mismas claves en cualquier orden dan el mismo texto (JSONB no conserva el orden). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Huella (SHA-256) del contenido de un valor JSON. Sirve para que un registro
 * de auditoría diga *qué versión* quedó guardada sin copiar el contenido: dos
 * contenidos distintos dan huellas distintas, y el mismo contenido da siempre
 * la misma aunque la base lo devuelva con las claves en otro orden.
 */
export function contentFingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
