import { AMBIGUOUS_REASON, MAX_LAB_REPORT_ROWS, containsPrintedValue, normalizeAnalyteKey, parsePrintedNumber, type ParsedLabRow } from './lab-report-parser'

export { containsPrintedValue }

/**
 * Segunda lectura de un informe de laboratorio.
 *
 * Un modelo puede leer un formato que las reglas no conocen, pero también
 * puede copiar mal una cifra. Por eso nada de lo que propone se acepta sin
 * comprobar:
 *
 * - En un PDF con texto, el valor tiene que figurar entero, carácter por
 *   carácter, en el renglón que cita. Lo que no figura se descarta.
 * - En una foto o un escaneo no hay texto contra el cual comprobar: se piden
 *   dos lecturas independientes y lo que no coincide queda para que lo decida
 *   una persona mirando la imagen.
 *
 * Este archivo no llama a ningún modelo: recibe las lecturas y las compara.
 */

/** Fila tal como la devuelve un lector (modelo): cita el renglón de donde la sacó. */
export interface ReaderRow {
  analyte: string
  printedValue: string
  unit: string | null
  referenceRange: string | null
  line: number
}

export interface ImageReading {
  /** Transcripción de la imagen, renglón por renglón. */
  lines: string[]
  rows: ReaderRow[]
}

export interface MergedLabRow extends Omit<ParsedLabRow, 'sourceLine'> {
  /** null: la fila no cita un renglón de la transcripción. */
  sourceLine: number | null
  /** Las lecturas no coinciden: una persona tiene que decidir antes de confirmar. */
  mustDecide: boolean
  /** El valor que leyó la otra lectura, cuando difiere. */
  alternative: string | null
}

const MAX_NAME_CHARS = 80
const MAX_VALUE_CHARS = 60
const MAX_UNIT_CHARS = 20
const MAX_RANGE_CHARS = 120

const MODEL_ONLY_REASON = 'Lo encontró la segunda lectura y las reglas no: revisalo.'
const RULES_ONLY_REASON = 'La segunda lectura no encontró este valor: revisalo.'
const SINGLE_READING_REASON = 'Una sola lectura: comparalo con la imagen.'
const ONE_SIDE_REASON = 'Solo una de las dos lecturas encontró este valor: comparalo con la imagen.'

/** Un resultado posible: un número (con o sin comparador) o un texto corto. Un intervalo no lo es. */
function looksLikeResult(value: string): boolean {
  if (value.length === 0 || value.length > MAX_VALUE_CHARS) return false
  if (/^\d[\d.,]*\s*(-|–|a|y)\s*\d/i.test(value)) return false
  if (parsePrintedNumber(value).value !== null) return true
  // "< 0,5", "No reactivo", "1/64".
  return /^[<>≤≥]\s*\d(?:[\d.,]*\d)?$/.test(value) || (/\p{L}/u.test(value) && !/\d/.test(value)) || /^\d+\s*[/:]\s*\d+$/.test(value)
}

function cleanText(value: string | null, max: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  return text.length === 0 || text.length > max ? null : text
}

function sanitize(row: ReaderRow): ReaderRow | null {
  const analyte = typeof row.analyte === 'string' ? row.analyte.replace(/\s+/g, ' ').trim() : ''
  let printedValue = typeof row.printedValue === 'string' ? row.printedValue.trim() : ''
  let unit = cleanText(row.unit, MAX_UNIT_CHARS)
  // "13,5 g/dL" en el campo del valor: el número es el valor y el resto, la unidad.
  const withUnit = printedValue.match(/^((?:[<>≤≥]\s*)?\d(?:[\d.,]*\d)?)\s*([^\d\s.,<>≤≥-].*)$/)
  if (withUnit) {
    printedValue = withUnit[1]!
    unit ??= cleanText(withUnit[2]!, MAX_UNIT_CHARS)
  }
  if (analyte.length === 0 || analyte.length > MAX_NAME_CHARS || normalizeAnalyteKey(analyte).length === 0) return null
  if (!looksLikeResult(printedValue) || !Number.isInteger(row.line)) return null
  return { analyte, printedValue, unit, referenceRange: cleanText(row.referenceRange, MAX_RANGE_CHARS), line: row.line }
}

/**
 * Deja solo las filas cuyo valor figura en el renglón que citan. Si el lector
 * erró el renglón por uno y el valor está en el de al lado, la fila se reubica.
 */
export function groundReaderRows(rows: readonly ReaderRow[], lines: readonly string[]): { rows: ReaderRow[]; dropped: number } {
  const kept: ReaderRow[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const raw of rows) {
    const row = sanitize(raw)
    let line = -1
    if (row) {
      const holds = (index: number): boolean => lines[index] !== undefined && containsPrintedValue(lines[index]!, row.printedValue)
      if (holds(row.line)) {
        line = row.line
      } else {
        const neighbours = [row.line - 1, row.line + 1].filter(holds)
        const word = normalizeAnalyteKey(row.analyte).split(' ')[0] ?? ''
        const named = neighbours.filter((index) => word.length > 0 && normalizeAnalyteKey(lines[index]!).includes(word))
        if (neighbours.length === 1) line = neighbours[0]!
        else if (named.length === 1) line = named[0]!
      }
    }
    const key = `${line}|${row?.printedValue}`
    if (!row || line === -1 || seen.has(key) || kept.length >= MAX_LAB_REPORT_ROWS) {
      dropped += 1
      continue
    }
    seen.add(key)
    kept.push({ ...row, line })
  }
  return { rows: kept, dropped }
}

/** Mismo analito: el mismo nombre normalizado, o uno contiene al otro ("Glucosa" y "Glucosa en sangre"). */
function sameAnalyte(a: string, b: string): boolean {
  const left = normalizeAnalyteKey(a)
  const right = normalizeAnalyteKey(b)
  if (left === right) return true
  return ` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `)
}

function fromReader(row: ReaderRow, reason: string, sourceLine: number | null, mustDecide: boolean): MergedLabRow {
  const { value, ambiguous } = parsePrintedNumber(row.printedValue)
  return {
    analyte: row.analyte,
    printedValue: row.printedValue,
    value,
    unit: row.unit,
    referenceRange: row.referenceRange,
    sourceLine,
    needsReview: true,
    reviewReason: ambiguous && !mustDecide ? AMBIGUOUS_REASON : reason,
    mustDecide,
    alternative: null,
  }
}

export interface MergedTextReadings {
  rows: MergedLabRow[]
  /** Filas en las que reglas y modelo coincidieron. */
  agreed: number
  /** Filas del modelo descartadas porque su valor no figura en el texto. */
  dropped: number
}

/**
 * Une la lectura por reglas con la del modelo sobre el mismo texto. `model`
 * null significa que no hubo segunda lectura: quedan las filas de las reglas.
 */
export function mergeTextReadings(rules: readonly ParsedLabRow[], model: readonly ReaderRow[] | null, lines: readonly string[]): MergedTextReadings {
  if (model === null) {
    return { rows: rules.map((row) => ({ ...row, mustDecide: false, alternative: null })), agreed: 0, dropped: 0 }
  }
  const grounded = groundReaderRows(model, lines)
  const used = new Set<ReaderRow>()
  let agreed = 0

  const rows: MergedLabRow[] = rules.map((row) => {
    const match = grounded.rows.find((candidate) => !used.has(candidate) && candidate.line === row.sourceLine && candidate.printedValue === row.printedValue.trim())
    let reason = row.reviewReason
    if (!match) {
      reason ??= RULES_ONLY_REASON
    } else {
      used.add(match)
      if (sameAnalyte(row.analyte, match.analyte)) agreed += 1
      else reason ??= `La segunda lectura lo llama «${match.analyte}»: revisá el nombre.`
    }
    return { ...row, needsReview: reason !== null, reviewReason: reason, mustDecide: false, alternative: null }
  })

  for (const extra of grounded.rows) {
    if (used.has(extra) || rows.length >= MAX_LAB_REPORT_ROWS) continue
    const line = lines[extra.line] ?? ''
    // Unidad y rango solo si también figuran en el renglón: no se acepta nada que el texto no diga.
    const unit = extra.unit !== null && line.includes(extra.unit) ? extra.unit : null
    const referenceRange = extra.referenceRange !== null && line.includes(extra.referenceRange) ? extra.referenceRange : null
    rows.push(fromReader({ ...extra, unit, referenceRange }, MODEL_ONLY_REASON, extra.line, false))
  }

  const order = new Map(rows.map((row, index) => [row, index]))
  rows.sort((a, b) => (a.sourceLine ?? Infinity) - (b.sourceLine ?? Infinity) || order.get(a)! - order.get(b)!)
  return { rows, agreed, dropped: grounded.dropped }
}

export interface MergedImageReadings {
  /** Transcripción de la primera lectura: es la que se guarda y se muestra. */
  lines: string[]
  rows: MergedLabRow[]
  /** Filas en las que las dos lecturas no coinciden o que vio una sola. */
  disagreements: number
  /** Filas descartadas porque su valor no figura en la transcripción de su propia lectura. */
  dropped: number
  /** No hubo segunda lectura: ninguna fila está comprobada. */
  singleReading: boolean
}

/**
 * Compara dos lecturas independientes de la misma imagen. La primera aporta
 * la transcripción; la segunda solo sirve para comprobar. Coma y punto no se
 * igualan: "0,9" y "0.9" son lecturas distintas.
 */
export function mergeImageReadings(first: ImageReading, second: ImageReading | null): MergedImageReadings {
  const a = groundReaderRows(first.rows, first.lines)
  const lines = [...first.lines]

  if (second === null) {
    return { lines, rows: a.rows.map((row) => fromReader(row, SINGLE_READING_REASON, row.line, false)), disagreements: 0, dropped: a.dropped, singleReading: true }
  }

  // La segunda lectura se comprueba contra su propia transcripción cuando la trae.
  const b = second.lines.length > 0 ? groundReaderRows(second.rows, second.lines).rows : second.rows.map(sanitize).filter((row): row is ReaderRow => row !== null)
  const used = new Set<ReaderRow>()
  const partner = new Map<ReaderRow, ReaderRow>()
  // Primero los nombres idénticos; después "Creatinina" con "Creatinina sérica".
  for (const exact of [true, false]) {
    for (const row of a.rows) {
      if (partner.has(row)) continue
      const key = normalizeAnalyteKey(row.analyte)
      const match = b.find((candidate) => !used.has(candidate) && (exact ? normalizeAnalyteKey(candidate.analyte) === key : sameAnalyte(candidate.analyte, row.analyte)))
      if (match) {
        used.add(match)
        partner.set(row, match)
      }
    }
  }

  let disagreements = 0
  const rows: MergedLabRow[] = a.rows.map((row) => {
    const match = partner.get(row)
    if (!match) {
      disagreements += 1
      return fromReader(row, ONE_SIDE_REASON, row.line, true)
    }
    if (match.printedValue.replace(/\s+/g, '') === row.printedValue.replace(/\s+/g, '')) {
      const { value, ambiguous } = parsePrintedNumber(row.printedValue)
      return { analyte: row.analyte, printedValue: row.printedValue, value, unit: row.unit, referenceRange: row.referenceRange, sourceLine: row.line, needsReview: ambiguous, reviewReason: ambiguous ? AMBIGUOUS_REASON : null, mustDecide: false, alternative: null }
    }
    disagreements += 1
    return {
      ...fromReader(row, `Las dos lecturas no coinciden: «${row.printedValue}» y «${match.printedValue}». Mirá la imagen y elegí.`, row.line, true),
      alternative: match.printedValue,
    }
  })

  for (const extra of b) {
    if (used.has(extra) || rows.length >= MAX_LAB_REPORT_ROWS) continue
    disagreements += 1
    rows.push(fromReader(extra, ONE_SIDE_REASON, null, true))
  }

  return { lines, rows, disagreements, dropped: a.dropped, singleReading: false }
}
