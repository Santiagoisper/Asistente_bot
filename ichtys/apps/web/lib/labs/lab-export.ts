import { dayKeyInZone, timeInZone } from '../agenda/agenda-time'

/**
 * Exportación de un estudio ya revisado. No envía nada a ningún sistema: arma
 * el archivo o el texto para que una persona lo lleve adonde haga falta.
 */
export interface ExportRow {
  analyte: string
  printedValue: string
  value: number | null
  unit: string | null
  referenceRange: string | null
}

const HEADER = ['Sujeto', 'Analito', 'Valor impreso', 'Valor numérico', 'Unidad', 'Referencia', 'Revisado']
const BOM = '﻿'
/** Con coma decimal, Excel en español separa columnas por punto y coma. */
const SEPARATOR = ';'

function singleLine(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').trim()
}

/**
 * Una planilla ejecuta como fórmula lo que empieza con = + - @. El texto de un
 * informe viene de afuera: esas celdas salen con un apóstrofo adelante. Un
 * número negativo no es una fórmula y queda igual.
 */
function neutralizeFormula(text: string): string {
  if (/^-\d[\d.,]*$/.test(text)) return text
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function csvCell(raw: string): string {
  const text = neutralizeFormula(singleLine(raw))
  return /[";]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** El número elegido por quien revisó, con coma decimal. */
function numericCell(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',')
}

export function labReportCsv(input: { subjectCode: string; reviewedAt: Date | null; timeZone: string; rows: ExportRow[] }): string {
  const reviewed = input.reviewedAt ? `${dayKeyInZone(input.reviewedAt, input.timeZone)} ${timeInZone(input.reviewedAt, input.timeZone)}` : ''
  const lines = input.rows.map((row) =>
    [
      csvCell(input.subjectCode),
      csvCell(row.analyte),
      csvCell(row.printedValue),
      numericCell(row.value),
      csvCell(row.unit ?? ''),
      csvCell(row.referenceRange ?? ''),
      reviewed,
    ].join(SEPARATOR),
  )
  return `${BOM}${[HEADER.join(SEPARATOR), ...lines].join('\r\n')}\r\n`
}

/**
 * Para pegar en otra pantalla: analito, valor impreso y unidad separados por
 * tabulación. Va el valor tal cual está impreso, sin agregarle nada.
 */
export function labRowsForClipboard(rows: ExportRow[]): string {
  return rows.map((row) => [row.analyte, row.printedValue, row.unit ?? ''].map(singleLine).join('\t')).join('\n')
}

export function exportFileName(subjectCode: string, reviewedAt: Date | null, timeZone: string): string {
  const code = subjectCode.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
  const parts = ['laboratorio', code, reviewedAt ? dayKeyInZone(reviewedAt, timeZone) : ''].filter((part) => part.length > 0)
  return `${parts.join('-')}.csv`
}

/** Nombre con el que el navegador guarda la descarga: el del servidor si es uno de los nuestros. */
export function downloadName(contentDisposition: string | null): string {
  const name = /filename="([^"]+)"/.exec(contentDisposition ?? '')?.[1]
  return name && /^laboratorio[A-Za-z0-9_-]*\.csv$/.test(name) ? name : 'laboratorio.csv'
}
