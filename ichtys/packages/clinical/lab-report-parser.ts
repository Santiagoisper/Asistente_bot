/**
 * Intérprete determinista de un informe de laboratorio en texto (PDF digital).
 *
 * Reglas (spec 2026-11-10-os-carga-laboratorios):
 *  - Tal cual: el valor se conserva como está impreso; el número va aparte.
 *  - Sin inventar: cada fila cita un renglón que contiene su valor impreso.
 *  - Nada identificatorio: el encabezado se omite y los renglones con datos
 *    personales se tapan antes de devolver la transcripción.
 *  - No decide: lo ambiguo queda marcado para que lo resuelva una persona.
 * No llama a ningún modelo.
 */

export interface ParsedLabRow {
  /** Nombre del analito tal cual figura. */
  analyte: string
  /** Valor tal cual figura: "13,5", "7.300", "< 0,5", "Negativo". */
  printedValue: string
  /** Número interpretado; null si no es numérico o es una desigualdad. */
  value: number | null
  unit: string | null
  /** Rango de referencia tal cual figura. */
  referenceRange: string | null
  /** Índice del renglón en `lines`. */
  sourceLine: number
  needsReview: boolean
  reviewReason: string | null
}

export interface ParsedLabReport {
  transcription: string
  lines: string[]
  rows: ParsedLabRow[]
  /** Renglones con números que no se pudieron interpretar como resultado. */
  unparsedLines: number[]
  piiRedactedCount: number
}

export const MAX_LAB_REPORT_LINES = 3_000
export const MAX_LAB_REPORT_ROWS = 500
const MAX_LINE_CHARS = 300
const MAX_ANALYTE_CHARS = 120
const MAX_UNIT_CHARS = 20
const MAX_RANGE_CHARS = 120
const LONG_NAME_CHARS = 60

const AMBIGUOUS_REASON = 'Puede ser miles o decimal: confirmá cómo se lee.'
const LONG_NAME_REASON = 'Nombre largo: revisá que sea un analito.'

/** Interpreta un valor impreso en formato argentino. No adivina desigualdades ni textos. */
export function parsePrintedNumber(printed: string): { value: number | null; ambiguous: boolean } {
  const text = printed.trim()
  const none = { value: null, ambiguous: false }
  if (!/^\d[\d.,]*$/.test(text)) return none

  // 1.234,5 — miles con punto y decimales con coma.
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(text)) return { value: Number(text.replace(/\./g, '').replace(',', '.')), ambiguous: false }
  // 4.620.000 — dos o más grupos de miles.
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(text)) return { value: Number(text.replace(/\./g, '')), ambiguous: false }
  // 7.300 o 1.025 — un punto y tres dígitos: miles o decimal.
  if (/^\d{1,3}\.\d{3}$/.test(text)) return { value: Number(text.replace('.', '')), ambiguous: true }
  // 1,025 — una coma y tres dígitos: decimal en formato local, miles en formato inglés.
  if (/^\d{1,3},\d{3}$/.test(text)) return { value: Number(text.replace(',', '.')), ambiguous: true }
  if (/^\d+,\d+$/.test(text)) return { value: Number(text.replace(',', '.')), ambiguous: false }
  if (/^\d+\.\d+$/.test(text)) return { value: Number(text), ambiguous: false }
  if (/^\d+$/.test(text)) return { value: Number(text), ambiguous: false }
  return none
}

/**
 * Lecturas numéricas que una persona puede elegir para un valor impreso.
 * Sin ambigüedad: su número, o dejarlo sin número. Ambiguo: las dos lecturas.
 */
export function numericReadings(printedValue: string): Array<number | null> {
  const text = printedValue.trim()
  const { value, ambiguous } = parsePrintedNumber(text)
  if (value === null) return [null]
  if (!ambiguous) return [value, null]
  const other = text.includes('.') ? Number(text) : Number(text.replace(',', ''))
  return [value, other, null]
}

/** Clave del catálogo: minúsculas, sin acentos ni signos, espacios colapsados. */
export function normalizeAnalyteKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** La fila cita un renglón existente que contiene su valor impreso carácter por carácter. */
export function rowIsGrounded(row: Pick<ParsedLabRow, 'printedValue' | 'sourceLine'>, lines: string[]): boolean {
  const line = lines[row.sourceLine]
  return typeof line === 'string' && row.printedValue.length > 0 && line.includes(row.printedValue)
}

/** Primera palabra de un renglón que nunca es un analito. */
const NOT_ANALYTE_FIRST_WORD = new Set([
  'edad', 'dni', 'documento', 'doc', 'hc', 'historia', 'afiliado', 'credencial', 'protocolo', 'orden', 'paciente',
  'nombre', 'apellido', 'sexo', 'fecha', 'hora', 'tel', 'telefono', 'pagina', 'pag', 'hoja', 'medico', 'dr', 'dra',
  'solicitante', 'obra', 'plan', 'domicilio', 'direccion', 'sucursal', 'sede', 'muestra', 'metodo', 'matricula',
  'mn', 'mp', 'cuit', 'cuil', 'nro', 'n', 'validado', 'firma', 'impreso', 'ingreso', 'emision', 'recepcion',
])

/** Renglón que identifica al paciente: se tapa entero, esté donde esté. */
const IDENTIFYING_LINE =
  /^\s*(paciente|nombre|apellido|d\.?\s?n\.?\s?i\.?|documento|cuil|cuit|h\.?\s?c\.?\b|historia\s+cl[ií]nica|afiliado|credencial|obra\s+social|domicilio|direcci[oó]n|tel[eé]fono|tel\.|e-?mail|correo|fecha\s+de\s+nac|nacimiento|edad|sexo)\b/i

/** Fecha operativa del informe: es lo único del encabezado que se conserva. */
const KEPT_HEADER_DATE =
  /^\s*fecha\s*(de\s+)?(la\s+)?(extracci[oó]n|toma|muestra|informe|emisi[oó]n|recepci[oó]n|ingreso|validaci[oó]n)?\s*[:.]?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s*$/i

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const VALUE_TOKEN = /^\d[\d.,]*$/
const COMPARATOR = /^[<>≤≥]$/
const COMPARATOR_VALUE = /^[<>≤≥]\d[\d.,]*$/
const QUALITATIVE =
  /^(.{2,}?)\s*[:\s]\s*(negativo|positivo|no\s+reactivo|reactivo|normal|trazas|ausente|presente|indetectable|detectable|no\s+se\s+observan?|no\s+contiene|contiene)\.?$/i
const RANGE_PREFIX = /^(v\.?\s?r\.?|ref\.?|referencia|valor(es)?\s+de\s+referencia)\s*[:.]?\s*/i

interface RowDraft {
  analyte: string
  printedValue: string
  unit: string | null
  referenceRange: string | null
}

function firstWordKey(name: string): string {
  return normalizeAnalyteKey(name).split(' ')[0] ?? ''
}

function validAnalyteName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_ANALYTE_CHARS) return false
  if ((name.match(/\p{L}/gu)?.length ?? 0) < 2) return false
  return !NOT_ANALYTE_FIRST_WORD.has(firstWordKey(name))
}

function cleanRange(rest: string): string | null {
  let range = rest.trim()
  if (range.startsWith('(') && range.endsWith(')')) range = range.slice(1, -1).trim()
  range = range.replace(RANGE_PREFIX, '').trim()
  if (range.startsWith('(') && range.endsWith(')')) range = range.slice(1, -1).trim()
  if (range.length === 0 || range.length > MAX_RANGE_CHARS || !/\d/.test(range)) return null
  return range
}

/** Devuelve la fila que describe el renglón, o null si no es un resultado. */
function draftFromLine(line: string): RowDraft | null {
  if (line.length === 0 || line.length > MAX_LINE_CHARS) return null
  const tokens = line.replace(/\.{2,}/g, ' ').split(/\s+/).filter((token) => token.length > 0)

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!
    let printedValue: string | null = null
    let next = index + 1

    if (VALUE_TOKEN.test(token) || COMPARATOR_VALUE.test(token)) {
      printedValue = token
    } else if (COMPARATOR.test(token) && tokens[index + 1] !== undefined && VALUE_TOKEN.test(tokens[index + 1]!)) {
      // Se recupera el valor tal cual está en el renglón, con su espaciado original.
      const pattern = new RegExp(`\\${token}\\s*${tokens[index + 1]!.replace(/[.]/g, '\\.')}`)
      printedValue = line.match(pattern)?.[0] ?? null
      next = index + 2
    }
    if (printedValue === null) continue

    const analyte = tokens.slice(0, index).join(' ').replace(/[:\s]+$/, '')
    if (!validAnalyteName(analyte)) return null

    let unit: string | null = null
    const candidate = tokens[next]
    if (
      candidate !== undefined &&
      candidate.length <= MAX_UNIT_CHARS &&
      !candidate.startsWith('(') &&
      !/^\d/.test(candidate) &&
      !COMPARATOR.test(candidate) &&
      !RANGE_PREFIX.test(`${candidate} `) &&
      !/^(hasta|mayor|menor|entre|de)$/i.test(candidate) &&
      /[\p{L}%/]/u.test(candidate)
    ) {
      unit = candidate
      next += 1
    }
    return { analyte, printedValue, unit, referenceRange: cleanRange(tokens.slice(next).join(' ')) }
  }

  const qualitative = line.match(QUALITATIVE)
  if (qualitative) {
    const analyte = qualitative[1]!.replace(/[:\s.]+$/, '').trim()
    const printedValue = line.slice(line.length - qualitative[0].length + qualitative[0].lastIndexOf(qualitative[2]!)).replace(/\.$/, '')
    if (validAnalyteName(analyte) && !/\d/.test(analyte)) {
      return { analyte, printedValue: printedValue.trim(), unit: null, referenceRange: null }
    }
  }
  return null
}

export function parseLabReportText(rawText: string): ParsedLabReport {
  const source = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, MAX_LAB_REPORT_LINES)
    .map((line) => line.replace(/\t/g, ' ').trimEnd())

  const drafts = source.map((line) => draftFromLine(line.trim()))
  const firstResult = drafts.findIndex((draft) => draft !== null)
  const headerEnd = firstResult === -1 ? source.length : firstResult

  const lines: string[] = []
  const rows: ParsedLabRow[] = []
  const unparsedLines: number[] = []
  let piiRedactedCount = 0

  // Encabezado: se conserva solo la fecha operativa; el resto se omite.
  const droppedHeader = new Set<string>()
  const keptHeader: string[] = []
  for (const line of source.slice(0, headerEnd)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (KEPT_HEADER_DATE.test(trimmed)) {
      keptHeader.push(trimmed)
    } else {
      droppedHeader.add(normalizeAnalyteKey(trimmed))
      piiRedactedCount += 1
    }
  }
  if (piiRedactedCount > 0) {
    lines.push(`[Encabezado omitido: ${piiRedactedCount} ${piiRedactedCount === 1 ? 'renglón' : 'renglones'}]`)
  }
  lines.push(...keptHeader)

  for (let index = headerEnd; index < source.length; index += 1) {
    const original = source[index]!
    const trimmed = original.trim()
    if (trimmed.length === 0) {
      lines.push('')
      continue
    }
    // Encabezado repetido en otra página, o renglón con datos personales.
    if (IDENTIFYING_LINE.test(trimmed) || droppedHeader.has(normalizeAnalyteKey(trimmed))) {
      lines.push('[Renglón omitido]')
      piiRedactedCount += 1
      continue
    }
    let kept = original
    if (EMAIL.test(kept)) {
      kept = kept.replace(EMAIL, '[omitido]')
      piiRedactedCount += 1
    }
    EMAIL.lastIndex = 0

    const lineIndex = lines.push(kept) - 1
    const draft = kept === original ? drafts[index] : draftFromLine(kept.trim())
    if (draft && rows.length < MAX_LAB_REPORT_ROWS) {
      const { value, ambiguous } = parsePrintedNumber(draft.printedValue)
      const reviewReason = ambiguous ? AMBIGUOUS_REASON : draft.analyte.length > LONG_NAME_CHARS ? LONG_NAME_REASON : null
      rows.push({ ...draft, value, sourceLine: lineIndex, needsReview: reviewReason !== null, reviewReason })
    } else if (!draft && /\d/.test(trimmed)) {
      unparsedLines.push(lineIndex)
    }
  }

  return { transcription: lines.join('\n'), lines, rows, unparsedLines, piiRedactedCount }
}
