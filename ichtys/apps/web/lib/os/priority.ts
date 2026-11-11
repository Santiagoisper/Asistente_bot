export type PrioritySeverity = 'high' | 'medium' | 'low'

export interface PriorityItem {
  id: string
  kind: 'lab' | 'ingestion' | 'spec' | 'satellite'
  severity: PrioritySeverity
  title: string
  detail: string
  /** Pantalla donde se resuelve. Interna (empieza con "/") o del satélite (http/https). */
  href: string
  /** ISO 8601, o null si no se conoce desde cuándo espera. */
  since: string | null
}

const SEVERITY_RANK: Record<PrioritySeverity, number> = { high: 0, medium: 1, low: 2 }

/**
 * Orden de "Atención prioritaria": primero lo más grave; a igual gravedad,
 * lo que espera hace más tiempo. Lo que no tiene fecha va al final de su grupo.
 */
export function sortPriorityItems(items: PriorityItem[]): PriorityItem[] {
  const time = (item: PriorityItem) => {
    const parsed = item.since ? Date.parse(item.since) : Number.NaN
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
  }
  return [...items].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || time(a) - time(b) || a.id.localeCompare(b.id),
  )
}

export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}
