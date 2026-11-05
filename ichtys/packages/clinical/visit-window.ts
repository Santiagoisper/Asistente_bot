/**
 * Motor de ventanas de visita (ALPHI 2.0), portado desde
 * 06bdda5:ichtys/apps/web/lib/visit-window.ts (ADR-7 §2.3).
 * Aritmética pura en UTC sobre fechas ISO YYYY-MM-DD.
 * Falla cerrado: cualquier entrada inválida devuelve null.
 */

export type VisitWindow = {
  targetDate: string
  windowStart: string
  windowEnd: string
  version: string
}

export const VISIT_WINDOW_VERSION = 'visit-window-motor v0.1.0 (TS mirror)'
const MS_POR_DIA = 86_400_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isValidIsoDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false
  const d = new Date(`${iso}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function computeVisitWindow({
  anchorDate,
  targetDay,
  toleranceBefore,
  toleranceAfter,
}: {
  anchorDate: string
  targetDay: number
  toleranceBefore: number
  toleranceAfter: number
}): VisitWindow | null {
  if (toleranceBefore < 0 || toleranceAfter < 0) return null
  if (!Number.isInteger(targetDay)) return null
  if (!isValidIsoDate(anchorDate)) return null

  // Medianoche UTC: el parser local (UTC-3) no corre el día, y el motor queda determinista.
  const base = Date.parse(`${anchorDate}T00:00:00.000Z`)
  const targetMs = base + targetDay * MS_POR_DIA
  const target = new Date(targetMs)
  const start = new Date(targetMs - toleranceBefore * MS_POR_DIA)
  const end = new Date(targetMs + toleranceAfter * MS_POR_DIA)

  return {
    targetDate: toIso(target),
    windowStart: toIso(start),
    windowEnd: toIso(end),
    version: VISIT_WINDOW_VERSION,
  }
}

export interface NormalizedVisitWindow {
  before: number | null
  after: number | null
}

/**
 * Lectura única de la ventana (ADR-7 §2.2). Si las dos cotas nuevas son null
 * y el legado `windowDays` no, las dos valen `windowDays`.
 */
export function normalizeVisitWindow(visit: {
  windowDays?: number | null
  windowBefore?: number | null
  windowAfter?: number | null
}): NormalizedVisitWindow {
  const before = visit.windowBefore ?? null
  const after = visit.windowAfter ?? null
  const legacy = visit.windowDays
  if (before === null && after === null && typeof legacy === 'number') {
    return { before: legacy, after: legacy }
  }
  return { before, after }
}

export interface SpecVisitWindowInput {
  day: number | null
  windowDays?: number | null
  windowBefore?: number | null
  windowAfter?: number | null
}

/** Arma la entrada del motor desde una visita de la spec. Null si falta el día o un lado de la ventana. */
export function visitWindowInputFromSpec(
  visit: SpecVisitWindowInput,
  anchorDate: string,
): {
  anchorDate: string
  targetDay: number
  toleranceBefore: number
  toleranceAfter: number
} | null {
  if (visit.day === null || !Number.isInteger(visit.day)) return null
  const window = normalizeVisitWindow(visit)
  if (window.before === null || window.after === null) return null
  if (!Number.isInteger(window.before) || !Number.isInteger(window.after)) return null
  return {
    anchorDate,
    targetDay: visit.day,
    toleranceBefore: window.before,
    toleranceAfter: window.after,
  }
}
