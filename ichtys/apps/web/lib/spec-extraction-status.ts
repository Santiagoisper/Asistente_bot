/**
 * spec-extraction-status.ts — predicados puros para el banner de fallo/
 * advertencias de extracción del spec (apps/web/app/(app)/studies/[id]/spec).
 *
 * Fuente de verdad: `extractionFailed` / `extractionWarnings` dentro del
 * jsonb del spec (campo del ÚLTIMO INTENTO que expone @ichtys/ingestion —
 * en camino en otra rama, todavía no mergeada a main). Se leen en forma
 * defensiva porque el campo no existe aún en el tipo `StudySpec` de esta
 * rama: hoy siempre da `false`/`[]` y empieza a funcionar solo cuando el
 * campo llegue al merge, sin volver a tocar este archivo.
 *
 * `hasLegacyExtractionFailure` es compatibilidad con documentos de ANTES de
 * ese cambio, cuando un fallo de extracción del spec dejaba el
 * document_version entero en 'error' (semántica vieja). Solo debe usarse
 * cuando no hay spec guardado — una vez que el spec existe, manda su propio
 * campo `extractionFailed`.
 */

export interface ProtocolVersionStatusRow {
  status: 'pending' | 'processing' | 'ready' | 'error'
  errorMessage: string | null
}

/** ¿Hay al menos una versión del protocolo todavía en vuelo? */
export function isProtocolProcessing(versions: ProtocolVersionStatusRow[]): boolean {
  return versions.some((v) => v.status === 'pending' || v.status === 'processing')
}

/**
 * Semántica legada (pre `extractionFailed` en el spec): el documento quedó
 * en 'error' con ese código puntual porque falló solo la extracción del
 * spec (el resto de la ingesta — chunks/embeddings — sí se guardó).
 */
export function hasLegacyExtractionFailure(versions: ProtocolVersionStatusRow[]): boolean {
  return versions.some((v) => v.status === 'error' && v.errorMessage === 'spec_extraction_failed')
}

/** Lee `extractionFailed` del jsonb del spec sin depender de que el campo ya exista en el tipo. */
export function specHasExtractionFailed(spec: unknown): boolean {
  if (typeof spec !== 'object' || spec === null) return false
  return (spec as { extractionFailed?: unknown }).extractionFailed === true
}

/** Lee `extractionWarnings` del jsonb del spec, filtrando cualquier entrada que no sea string. */
export function specExtractionWarnings(spec: unknown): string[] {
  if (typeof spec !== 'object' || spec === null) return []
  const warnings = (spec as { extractionWarnings?: unknown }).extractionWarnings
  return Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === 'string') : []
}

/**
 * Resuelve si corresponde mostrar el banner de fallo de extracción.
 * Una versión en curso (re-subida, reintento) siempre gana sobre un fallo
 * previo — si no, un fallo viejo dejaría el banner pegado para siempre
 * aunque el usuario ya haya vuelto a subir el protocolo.
 */
export function resolveExtractionFailed(params: {
  protocolProcessing: boolean
  specExtractionFailed: boolean
  legacyExtractionFailed: boolean
}): boolean {
  if (params.protocolProcessing) return false
  return params.specExtractionFailed || params.legacyExtractionFailed
}
