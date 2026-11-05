/**
 * normalize/timing.ts — parser DETERMINISTA del tiempo de una visita (P3,
 * ADR-10 etapa c): texto del encabezado → {kind, value, unit} sin modelo.
 *
 * Formas reales (F1–F5):
 *   fila de timing   "12w", "-42d", "104w", "evt"
 *   label / id       "Día 1", "Día 15", "Semana 12", "Week 12", "Day −14",
 *                    "S12" (SEMANA, eje español), "W24", "D1"
 *
 * Reglas de oro (orden §0): primero lo determinista — este parser corre
 * ANTES de las llamadas; el modelo solo completa lo que aquí queda
 * `unparsed`. "evt"/vacío → evento (sin value). El texto de entrada es
 * dato, nunca se loguea (S8): los errores son `null`.
 *
 * G23-K1: un entero PELADO ("12") no trae unidad — en los reales es un
 * número de visita, o una semana si la etiqueta de la fila lo dice. Solo
 * parsea con `rowUnit` (la unidad declarada por la fila «Semanas»/«Día»);
 * sin ella devuelve null. Las columnas numeric_visit NUNCA llegan acá
 * (contrato del ensamblado). G23-K3: los topes de abuso son los del
 * contrato (mismas constantes); fuera de rango → null, sin throw — la
 * plausibilidad fina es del ensamblado.
 */
import { TIMING_VALUE_MAX, TIMING_VALUE_MIN } from '../schedule-contract'

export interface ParsedTiming {
  kind: 'scheduled' | 'event'
  value: number | null
  unit: 'day' | 'week' | null
}

/** Unidad declarada por la etiqueta de la fila («Semanas» → week). */
export interface ParseTimingOptions {
  rowUnit?: 'day' | 'week'
}

/** Normaliza signos menos tipográficos y espacios (puro). */
function normalizeDigitsText(raw: string): string {
  return raw
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

const DAY_WORD = /^(?:d|dia|dias|day|days)$/i
const WEEK_WORD = /^(?:s|semana|semanas|sem|w|week|weeks|wk)$/i

/** Palabra de unidad sin tildes («día» → «dia», como normalizeLabel en header.ts). */
function plainWord(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/** Valor dentro de los topes de abuso del contrato (G23-K3). */
function withinAbuseBounds(value: number): boolean {
  return value >= TIMING_VALUE_MIN && value <= TIMING_VALUE_MAX
}

function scheduled(value: number, unit: 'day' | 'week'): ParsedTiming | null {
  return withinAbuseBounds(value) ? { kind: 'scheduled', value, unit } : null
}

/**
 * Texto de tiempo → timing parcial. `null` si el texto no es un tiempo
 * reconocible (el llamador lo deja para el modelo o lo reporta).
 */
export function parseTiming(raw: string, opts?: ParseTimingOptions): ParsedTiming | null {
  const text = normalizeDigitsText(raw)
  if (text.length === 0) return null

  // Evento: sin número, la celda del generador imprime "evt" («n/c» y otros
  // textos sin número no son eventos — quedan null para el modelo).
  if (/^(?:evt|evento|event)$/i.test(text)) {
    return { kind: 'event', value: null, unit: null }
  }

  // Palabra + número: "Día 15", "Semana 12", "Week 12", "Day -14".
  const word = text.match(/^([^\d+-]+)\s*(-?\d{1,4})$/)
  if (word) {
    const unitWord = plainWord(word[1]!)
    const value = Number(word[2])
    if (DAY_WORD.test(unitWord)) return scheduled(value, 'day')
    if (WEEK_WORD.test(unitWord)) return scheduled(value, 'week')
    return null
  }

  // Ficha de eje o fila de timing: "S12", "W24", "D1", "D-14", "12w", "-42d".
  const chip = text.match(/^([SWDswd])\s*(-?\d{1,4})$/)
  if (chip) {
    const unit = /^[SWsw]/.test(chip[1]!) ? 'week' : 'day'
    return scheduled(Number(chip[2]), unit)
  }
  const stamped = text.match(/^(-?\d{1,4})\s*([DdWw])$/)
  if (stamped) {
    return scheduled(Number(stamped[1]), stamped[2]!.toLowerCase() === 'w' ? 'week' : 'day')
  }

  // Entero pelado ("12"): sin `rowUnit` NO se inventa unidad (G23-K1) — un
  // entero suelto en los reales es un número de visita. Con la unidad de la
  // fila ("Semanas" 1, 8, 15…), esa unidad es la del entero.
  const bare = text.match(/^(-?\d{1,4})(?:\s*(.+))?$/)
  if (bare) {
    const value = Number(bare[1])
    const tail = plainWord(bare[2] ?? '')
    if (tail.length === 0) {
      return opts?.rowUnit ? scheduled(value, opts.rowUnit) : null
    }
    if (DAY_WORD.test(tail)) return scheduled(value, 'day')
    if (WEEK_WORD.test(tail)) return scheduled(value, 'week')
  }
  return null
}
