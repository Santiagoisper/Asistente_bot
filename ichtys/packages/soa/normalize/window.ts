/**
 * normalize/window.ts — parser DETERMINISTA de la fila de ventanas (P3):
 * texto de la fila «Ventana»/«Visit window» → {before, after, unit} | null,
 * sin modelo (ADR-7: ventanas asimétricas before/after).
 *
 * Formas reales (F1–F5):
 *   "±2 d" "±3 d" "±7 d" "±14 d"        simétricas
 *   "−2/+3", "−4/+2 semanas"            asimétricas (−antes / +después)
 *   "Hasta 42 d" (partida en 4 ítems),   solo-after: before null
 *   "up to 7 d"
 *   "n/c" "n/a" "" "±"                   sin ventana → null
 *   "Margen de visita"                   etiqueta de fila, no valor → null
 *
 * `before`/`after` son magnitudes. G23-K2: los SIGNOS no son ruido — la
 * ventana asimétrica válida es «−A/+B» (antes/después del día). Dos signos
 * iguales («−7/−1», «+3/+7») dejan la ventana entera de un lado: eso no es
 * una ventana before/after y devuelve null (duda para el ensamblado).
 * «±0/+7» es válido: el ± con 0 es el lado «antes» vacío.
 *
 * G23-K3: tope de abuso compartido con el contrato (WINDOW_MARGIN_MAX);
 * fuera de rango → null, sin throw.
 */
import { WINDOW_MARGIN_MAX, type VisitWindow } from '../schedule-contract'

function normalizeText(raw: string): string {
  return raw
    .replace(/[−–—]/g, '-')
    .replace(/\+\/-/g, '±')
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

function withinAbuseBounds(n: number): boolean {
  return n >= 0 && n <= WINDOW_MARGIN_MAX
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

  // Asimétrica «−A/+B» (antes que la simétrica: el tail de «±N» se comería
  // el «/+7»). Válida: −A/+B explícito, ambos lados sin signo (implícito
  // −A/+B), o «±0/+B». Dos signos iguales → null (G23-K2).
  const asym = text.match(/^(±)?\s*([+-])?\s*(\d{1,3})\s*\/\s*(±)?\s*([+-])?\s*(\d{1,3})\s*(.*)$/)
  if (asym) {
    const [, tilde1, sign1, a, , sign2, b, tail] = asym
    const before = Number(a)
    const after = Number(b)
    const unit = unitOf(tail ?? '')
    const firstIsBefore = sign1 === '-' || (sign1 === undefined && tilde1 === undefined) || (tilde1 === '±' && before === 0)
    const secondIsAfter = sign2 === '+' || sign2 === undefined
    if (unit === null || !firstIsBefore || !secondIsAfter) return null
    if (!withinAbuseBounds(before) || !withinAbuseBounds(after)) return null
    return { before, after, unit }
  }

  // Simétrica: "±7 d", "± 7 días" (sin «/» — con barra era asimétrica).
  const sym = text.match(/^±\s*(\d{1,3})\s*([^\s/]*)$/)
  if (sym) {
    const n = Number(sym[1])
    const unit = unitOf(sym[2] ?? '')
    if (unit === null || !withinAbuseBounds(n)) return null
    return { before: n, after: n, unit }
  }

  // Solo after: "Hasta 42 d", "up to 7 d" (before null — ADR-7). La partida
  // de F1 se recompone con espacios: "Hast a 42 d".
  const until = text.match(/^(?:hasta|hast\s*a|up\s+to|m[aá]ximo|max)\s+(\d{1,3})\s*(.*)$/i)
  if (until) {
    const n = Number(until[1])
    const unit = unitOf(until[2] ?? '')
    if (unit === null || !withinAbuseBounds(n)) return null
    return { before: null, after: n, unit }
  }

  // Exacta "0 d" (F2 T1): sin tolerancia, el día justo. Con unidad EXPLÍCITA
  // — un entero pelado no trae unidad y no se inventa (mismo criterio que
  // G23-K1 en timing).
  const exact = text.match(/^(\d{1,3})\s*(.+)$/)
  if (exact) {
    const n = Number(exact[1])
    const unit = unitOf(exact[2] ?? '')
    if (unit !== null && withinAbuseBounds(n)) return { before: n, after: n, unit }
  }

  return null
}
