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
 * `unparsed`. Sin unidad explícita el día es la unidad por defecto (el eje
 * numérico del SoA es días). "evt"/vacío → evento (sin value). El texto de
 * entrada es dato, nunca se loguea (S8): los errores son `null`.
 */
export interface ParsedTiming {
  kind: 'scheduled' | 'event'
  value: number | null
  unit: 'day' | 'week' | null
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

/**
 * Texto de tiempo → timing parcial. `null` si el texto no es un tiempo
 * reconocible (el llamador lo deja para el modelo o lo reporta).
 */
export function parseTiming(raw: string): ParsedTiming | null {
  const text = normalizeDigitsText(raw)
  if (text.length === 0) return null

  // Evento: sin número, la celda del generador imprime "evt" («n/c» y otros
  // textos sin número no son eventos — quedan null para el modelo).
  if (/^(?:evt|evento|event)$/i.test(text)) {
    return { kind: 'event', value: null, unit: null }
  }

  // Palabra + número: "Día 15", "Semana 12", "Week 12", "Day -14".
  const word = text.match(/^([^\d+-]+)\s*(-?\d{1,3})$/)
  if (word) {
    const unitWord = plainWord(word[1]!)
    const value = Number(word[2])
    if (DAY_WORD.test(unitWord)) return { kind: 'scheduled', value, unit: 'day' }
    if (WEEK_WORD.test(unitWord)) return { kind: 'scheduled', value, unit: 'week' }
    return null
  }

  // Ficha de eje o fila de timing: "S12", "W24", "D1", "D-14", "12w", "-42d".
  const chip = text.match(/^([SWDswd])\s*(-?\d{1,3})$/)
  if (chip) {
    const value = Number(chip[2])
    const unit = /^[SWsw]/.test(chip[1]!) ? 'week' : 'day'
    return { kind: 'scheduled', value, unit }
  }
  const stamped = text.match(/^(-?\d{1,3})\s*([DdWw])$/)
  if (stamped) {
    return {
      kind: 'scheduled',
      value: Number(stamped[1]),
      unit: stamped[2]!.toLowerCase() === 'w' ? 'week' : 'day',
    }
  }

  // Entero pelado con unidad por palabra al final ("42 d"): día por defecto.
  const bare = text.match(/^(-?\d{1,3})(?:\s*(.+))?$/)
  if (bare) {
    const tail = plainWord(bare[2] ?? '')
    if (tail.length === 0) return { kind: 'scheduled', value: Number(bare[1]), unit: 'day' }
    if (DAY_WORD.test(tail)) return { kind: 'scheduled', value: Number(bare[1]), unit: 'day' }
    if (WEEK_WORD.test(tail)) return { kind: 'scheduled', value: Number(bare[1]), unit: 'week' }
  }
  return null
}
