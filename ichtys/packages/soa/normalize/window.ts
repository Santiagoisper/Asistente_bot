/**
 * normalize/window.ts — parser DETERMINISTA de la fila de ventanas (P3):
 * texto de la fila «Ventana»/«Visit window» → {before, after, unit} | null,
 * sin modelo (ADR-7: ventanas asimétricas before/after).
 *
 * Formas reales (F1–F5):
 *   "±2 d" "±3 d" "±7 d" "±14 d"        simétricas
 *   "−2/+3", "−4/+2 semanas"            asimétricas (magnitudes)
 *   "Hasta 42 d" (partida en 4 ítems),   solo-after: before null
 *   "up to 7 d"
 *   "n/c" "n/a" "" "±"                   sin ventana → null
 *   "Margen de visita"                   etiqueta de fila, no valor → null
 *
 * `before`/`after` son magnitudes (el signo del texto no viaja). Unidad por
 * defecto: día. El texto es dato: no se loguea (S8), fallo → null.
 */
import type { VisitWindow } from '../schedule-contract'

function normalizeText(raw: string): string {
  return raw
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

const DAY_TAIL = /^(?:d|dia|dias|day|days)$/i
const WEEK_TAIL = /^(?:w|sem|semana|semanas|week|weeks)$/i

function unitOf(tail: string): 'day' | 'week' | null {
  const t = tail
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
  if (t.length === 0 || DAY_TAIL.test(t)) return 'day'
  if (WEEK_TAIL.test(t)) return 'week'
  return null
}

/**
 * Texto de la fila de ventana → estructura del contrato. `null` cuando no
 * hay ventana («n/c») o el texto no es un valor de ventana.
 */
export function parseWindow(raw: string): VisitWindow | null {
  const text = normalizeText(raw)

  // Sin ventana: «n/c», «n/a», vacío, o texto que no es un valor («±» pelado
  // de F2, «Margen de visita» como etiqueta de fila).
  if (text.length === 0) return null
  if (/^(?:n\/?[ca]|nc|na|±|-)$/i.test(text)) return null
  if (!/\d/.test(text)) return null

  // Asimétrica (antes que la simétrica: el tail de «±N» se comería el
  // «/+7»): "−4/+2 semanas", "−2/+3", "±0/+7 d" — los signos son ruido,
  // before/after son magnitudes (ADR-7).
  const asym = text.match(/^±?\s*[-+]?\s*(\d{1,2})\s*\/\s*±?\s*[-+]?\s*(\d{1,2})\s*(.*)$/)
  if (asym) {
    const unit = unitOf(asym[3] ?? '')
    if (unit === null) return null
    return { before: Number(asym[1]), after: Number(asym[2]), unit }
  }

  // Simétrica: "±7 d", "± 7 días" (sin «/» — con barra era asimétrica).
  const sym = text.match(/^±\s*(\d{1,2})\s*([^\s/]*)$/)
  if (sym) {
    const unit = unitOf(sym[2] ?? '')
    if (unit === null) return null
    return { before: Number(sym[1]), after: Number(sym[1]), unit }
  }

  // Solo after: "Hasta 42 d", "up to 7 d" (before null — ADR-7). La partida
  // de F1 se recompone con espacios: "Hast a 42 d".
  const until = text.match(/^(?:hasta|hast\s*a|up\s+to|m[aá]ximo|max)\s+(\d{1,2})\s*(.*)$/i)
  if (until) {
    const unit = unitOf(until[2] ?? '')
    if (unit === null) return null
    return { before: null, after: Number(until[1]), unit }
  }

  return null
}
