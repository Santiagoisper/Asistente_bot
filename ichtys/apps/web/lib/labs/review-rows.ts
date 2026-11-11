import { numericReadings, parsePrintedNumber } from '@ichtys/clinical'
import type { LabReportRow, LabRowInput } from './lab-report-content'

/**
 * Estado de una fila en la pantalla de revisión. `reading` es la lectura
 * numérica elegida: 'unset' significa que la persona todavía no decidió.
 */
export interface ReviewRow {
  key: string
  analyte: string
  printedValue: string
  unit: string
  referenceRange: string
  sourceLine: number | null
  reading: number | null | 'unset'
  isNewField: boolean
  reviewReason: string | null
  /** Las dos lecturas no coinciden: hay que elegir o corregir antes de confirmar. */
  needsDecision: boolean
  /** Lo que leyó la otra lectura. */
  alternative: string | null
}

let manualSeq = 0

export function toReviewRow(row: LabReportRow): ReviewRow {
  return {
    key: row.id,
    analyte: row.analyte,
    printedValue: row.printedValue,
    unit: row.unit ?? '',
    referenceRange: row.referenceRange ?? '',
    sourceLine: row.sourceLine,
    // Lo que el programa marcó para revisar no trae una lectura decidida.
    reading: row.status === 'review' && parsePrintedNumber(row.printedValue).ambiguous ? 'unset' : row.value,
    isNewField: row.isNewField,
    reviewReason: row.reviewReason,
    needsDecision: row.mustDecide === true,
    alternative: row.alternative ?? null,
  }
}

export function emptyManualRow(): ReviewRow {
  manualSeq += 1
  return {
    key: `manual-${manualSeq}`,
    analyte: '',
    printedValue: '',
    unit: '',
    referenceRange: '',
    sourceLine: null,
    reading: null,
    isNewField: false,
    reviewReason: null,
    needsDecision: false,
    alternative: null,
  }
}

/**
 * Cambia el valor impreso de una fila. Si el texto nuevo ya no está en el
 * renglón del informe, la fila deja de citar ese renglón: pasa a ser una
 * corrección hecha a mano. La lectura numérica se recalcula.
 */
export function withPrintedValue(row: ReviewRow, printedValue: string, lines: string[]): ReviewRow {
  const text = printedValue.trim()
  const line = row.sourceLine === null ? undefined : lines[row.sourceLine]
  const stillInLine = line !== undefined && text.length > 0 && line.includes(text)
  const { value, ambiguous } = parsePrintedNumber(text)
  return {
    ...row,
    printedValue,
    sourceLine: stillInLine ? row.sourceLine : null,
    reading: ambiguous ? 'unset' : value,
    reviewReason: ambiguous ? 'Puede ser miles o decimal: confirmá cómo se lee.' : null,
    // Corregir el valor a mano es decidir.
    needsDecision: false,
    alternative: null,
  }
}

/**
 * Resuelve una diferencia entre lecturas eligiendo uno de los dos valores.
 * Elegir el que ya está es dejarlo como está y darlo por comparado.
 */
export function decideValue(row: ReviewRow, printedValue: string, lines: string[]): ReviewRow {
  if (printedValue.trim() === row.printedValue.trim()) return { ...row, needsDecision: false, alternative: null, reviewReason: row.reading === 'unset' ? row.reviewReason : null }
  return withPrintedValue(row, printedValue, lines)
}

/** Lecturas entre las que hay que elegir; vacío si el valor no es ambiguo. */
export function readingChoices(printedValue: string): number[] {
  if (!parsePrintedNumber(printedValue.trim()).ambiguous) return []
  return numericReadings(printedValue).filter((reading): reading is number => reading !== null)
}

export type RowProblem = 'missing_analyte' | 'missing_value' | 'needs_decision' | 'reading_unset'

export function rowProblem(row: ReviewRow): RowProblem | null {
  if (row.analyte.trim().length === 0) return 'missing_analyte'
  if (row.printedValue.trim().length === 0) return 'missing_value'
  if (row.needsDecision) return 'needs_decision'
  if (row.reading === 'unset') return 'reading_unset'
  return null
}

/** Filas listas para confirmar, o null si alguna todavía necesita a la persona. */
export function toConfirmPayload(rows: ReviewRow[]): LabRowInput[] | null {
  if (rows.length === 0 || rows.some((row) => rowProblem(row) !== null)) return null
  return rows.map((row) => ({
    analyte: row.analyte.trim(),
    printedValue: row.printedValue.trim(),
    value: row.reading === 'unset' ? null : row.reading,
    unit: row.unit.trim() || null,
    referenceRange: row.referenceRange.trim() || null,
    sourceLine: row.sourceLine,
  }))
}

const local = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 6 })
export function formatReading(value: number): string {
  return local.format(value)
}
