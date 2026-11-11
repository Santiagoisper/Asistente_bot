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

const HEADER = ['Estudio', 'Sujeto', 'Analito', 'Valor impreso', 'Valor numérico', 'Unidad', 'Referencia', 'Revisado', 'Informe']
const BOM = '\uFEFF'
/** Con coma decimal, Excel en español separa columnas por punto y coma. */
const SEPARATOR = ';'

function singleLine(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').trim()
}

/** Un resultado con signo ("-2,5", "+5") o solo signos ("++", "-"): no puede llevar una fórmula adentro. */
const PLAIN_SIGNED = /^[+-]+$|^[+-]\d[\d.,]*$/

/**
 * Una planilla ejecuta como fórmula lo que empieza con = + - @. El texto de un
 * informe viene de afuera: esas celdas salen con un apóstrofo adelante. Los
 * resultados con signo quedan tal cual están impresos.
 */
function neutralizeFormula(text: string): string {
  if (PLAIN_SIGNED.test(text)) return text
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

/** Identificador corto del informe: alcanza para distinguir dos informes del mismo sujeto. */
function shortReportId(reportId: string): string {
  return reportId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)
}

export interface ExportContext {
  /** Número de protocolo o nombre del estudio: el código de sujeto solo es único dentro de un estudio. */
  studyLabel: string
  subjectCode: string
  reportId: string
  reviewedAt: Date | null
  timeZone: string
}

export function labReportCsv(input: ExportContext & { rows: ExportRow[] }): string {
  const reviewed = input.reviewedAt ? `${dayKeyInZone(input.reviewedAt, input.timeZone)} ${timeInZone(input.reviewedAt, input.timeZone)}` : ''
  const study = csvCell(input.studyLabel)
  const subject = csvCell(input.subjectCode)
  const report = shortReportId(input.reportId)
  const lines = input.rows.map((row) =>
    [study, subject, csvCell(row.analyte), csvCell(row.printedValue), numericCell(row.value), csvCell(row.unit ?? ''), csvCell(row.referenceRange ?? ''), reviewed, report].join(SEPARATOR),
  )
  return `${BOM}${[HEADER.join(SEPARATOR), ...lines].join('\r\n')}\r\n`
}

/**
 * Para pegar en otra pantalla: analito, valor impreso y unidad separados por
 * tabulación. Lleva la misma protección que el CSV, por si se pega en una planilla.
 */
export function labRowsForClipboard(rows: ExportRow[]): string {
  return rows.map((row) => [row.analyte, row.printedValue, row.unit ?? ''].map((cell) => neutralizeFormula(singleLine(cell))).join('\t')).join('\n')
}

const fileSafe = (text: string, max: number): string => text.replace(/[^A-Za-z0-9_-]/g, '').slice(0, max)

export function exportFileName(input: ExportContext): string {
  const parts = [
    'laboratorio',
    fileSafe(input.studyLabel, 30),
    fileSafe(input.subjectCode, 40),
    input.reviewedAt ? dayKeyInZone(input.reviewedAt, input.timeZone) : '',
    shortReportId(input.reportId),
  ].filter((part) => part.length > 0)
  return `${parts.join('-')}.csv`
}

/** Nombre con el que el navegador guarda la descarga: el del servidor si es uno de los nuestros. */
export function downloadName(contentDisposition: string | null): string {
  const name = /filename="([^"]+)"/.exec(contentDisposition ?? '')?.[1]
  return name && /^laboratorio[A-Za-z0-9_-]*\.csv$/.test(name) ? name : 'laboratorio.csv'
}
