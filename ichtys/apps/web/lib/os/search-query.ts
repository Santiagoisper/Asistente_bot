export const SEARCH_MIN_CHARS = 2
export const SEARCH_MAX_CHARS = 80
export const SEARCH_LIMIT_PER_TYPE = 10

/** Escapa los comodines de LIKE para que el texto del usuario se busque literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Texto de búsqueda listo para usar, o null si es demasiado corto. */
export function normalizeSearchQuery(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().slice(0, SEARCH_MAX_CHARS)
  return trimmed.length >= SEARCH_MIN_CHARS ? trimmed : null
}

export interface SearchHit {
  id: string
  label: string
  detail: string
  href: string
}

export interface SearchResults {
  studies: SearchHit[]
  subjects: SearchHit[]
}

export const EMPTY_SEARCH: SearchResults = { studies: [], subjects: [] }
