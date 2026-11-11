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
 *
 * Columnas: el lector de PDF separa con tabulación las columnas de cada
 * renglón, y un renglón que empieza con tabulación está en la columna derecha
 * de la hoja. Los laboratorios ponen ahí los valores de referencia y la
 * interpretación, así que esos renglones nunca son resultados: se suman al
 * rango de la fila anterior. Sin tabulaciones (texto pegado), se usa el
 * intérprete por palabras.
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
const MAX_UNIT_CHARS = 20
const MAX_RANGE_CHARS = 120
const LONG_NAME_CHARS = 60
const MAX_NAME_CHARS = 80
const MAX_CONTINUATION_LINES = 4
const TAB = '\t'
/** La referencia impresa sigue en el informe y no entró completa. */
const MORE_MARK = ' …'

export const AMBIGUOUS_REASON = 'Puede ser miles o decimal: confirmá cómo se lee.'
const LONG_NAME_REASON = 'Nombre largo: revisá que sea un analito.'
const SECOND_VALUE_REASON = 'Segundo valor del mismo renglón: revisá el nombre.'
const NO_TITLE_REASON = 'No se encontró el nombre del analito: completalo.'
const FAR_TITLE_REASON = 'El nombre viene de un renglón más arriba: revisalo.'

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

const isDigitChar = (char: string | undefined): boolean => char !== undefined && char >= '0' && char <= '9'
const isNumberSeparator = (char: string | undefined): boolean => char === '.' || char === ','

/**
 * El valor figura en el renglón entero, no como parte de otro número:
 * "3,5" no figura en "13,5", ni "248" en "248.000".
 */
export function containsPrintedValue(line: string, printedValue: string): boolean {
  const value = printedValue.trim()
  if (value.length === 0) return false
  const startsWithDigit = isDigitChar(value[0])
  const endsWithDigit = isDigitChar(value[value.length - 1])
  let from = 0
  for (;;) {
    const at = line.indexOf(value, from)
    if (at === -1) return false
    const before = line[at - 1]
    const after = line[at + value.length]
    const cutBefore = startsWithDigit && (isDigitChar(before) || (isNumberSeparator(before) && isDigitChar(line[at - 2])))
    const cutAfter = endsWithDigit && (isDigitChar(after) || (isNumberSeparator(after) && isDigitChar(line[at + value.length + 1])))
    if (!cutBefore && !cutAfter) return true
    from = at + 1
  }
}

/** La fila cita un renglón existente que contiene su valor impreso carácter por carácter. */
export function rowIsGrounded(row: Pick<ParsedLabRow, 'printedValue' | 'sourceLine'>, lines: string[]): boolean {
  const line = lines[row.sourceLine]
  return typeof line === 'string' && containsPrintedValue(line, row.printedValue)
}

/** Primera palabra de un renglón que nunca es un analito. */
const NOT_ANALYTE_FIRST_WORD = new Set([
  'edad', 'dni', 'documento', 'doc', 'hc', 'historia', 'afiliado', 'credencial', 'protocolo', 'orden', 'paciente',
  'nombre', 'apellido', 'sexo', 'fecha', 'hora', 'tel', 'telefono', 'pagina', 'pag', 'hoja', 'medico', 'dr', 'dra',
  'solicitante', 'solicita', 'obra', 'plan', 'domicilio', 'direccion', 'sucursal', 'sede', 'muestra', 'metodo',
  'matricula', 'mn', 'mp', 'cuit', 'cuil', 'nro', 'n', 'validado', 'firma', 'impreso', 'ingreso', 'emision',
  'recepcion', 'habitacion', 'institucion', 'generacion', 'estudio', 'determinacion', 'cama', 'sala', 'piso',
  'servicio', 'origen', 'codigo', 'cod', 'interno', 'turno', 'peticion', 'solicitud', 'episodio', 'admision', 'ficha',
  'legajo', 'carnet', 'socio', 'beneficiario',
])

/** Renglones que describen cómo se hizo el análisis, no su resultado. */
const ANNOTATION_FIRST_WORD = new Set(['metodo', 'muestra', 'tipo', 'material', 'tecnica', 'equipo', 'observaciones', 'nota', 'notas'])

/** Renglón que identifica al paciente: se tapa entero, esté donde esté. */
const IDENTIFYING_LINE =
  /^\s*(h\.?\s?c\.?\s*(?:n[°ºro.]*\s*)?[:#\d]|tel\.|(paciente|nombre|apellido|d\.?\s?n\.?\s?i\.?|documento|cuil|cuit|historia\s+cl[ií]nica|afiliado|credencial|obra\s+social|domicilio|direcci[oó]n|tel[eé]fono|e-?mail|correo|fecha\s+de\s+nac|nacimiento|edad|sexo)(?![\p{L}\d]))/iu

/** Fecha operativa del informe: es lo único del encabezado que se conserva. */
const KEPT_HEADER_DATE =
  /^\s*fecha\s*(de\s+)?(la\s+)?(extracci[oó]n|toma|muestra|informe|emisi[oó]n|recepci[oó]n|ingreso|validaci[oó]n)?\s*[:.]?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s*$/i

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const VALUE_TOKEN = /^\d(?:[\d.,]*\d)?$/
const OMITTED = '[omitido]'
const COMPARATOR = /^[<>≤≥]$/
const COMPARATOR_VALUE = /^[<>≤≥]\d(?:[\d.,]*\d)?$/
const QUALITATIVE_WORDS =
  'negativo|positivo|no\\s+reactivo|reactivo|normal|trazas|ausente|presente|indetectable|detectable|no\\s+se\\s+observan?|no\\s+contiene|contiene'
const QUALITATIVE = new RegExp(`^(.{2,}?)\\s*[:\\s]\\s*(${QUALITATIVE_WORDS})\\.?$`, 'i')
const QUALITATIVE_ONLY = new RegExp(`^(${QUALITATIVE_WORDS})\\.?$`, 'i')
const RANGE_PREFIX = /^(v\.?\s?r\.?|ref\.?|referencia|valor(es)?\s+de\s+referencia)\s*[:.]?\s*/i
/** "Resultado 120 mg/dl" o "Valor Hallado:98 mg %": el nombre del analito está en un renglón anterior. */
const LABEL_ROW = /^(resultado|valor\s+hallado|valor\s+obtenido)\s*:?\s*(.*)$/i
/** Dirección, teléfono o web del laboratorio. */
const CONTACT_LINE = /\btel\b|\btel[:.(]|whats\s?app|www\.|https?:|@|\|/i
/** Firma, matrícula o pie de página. */
const SIGNATURE_LINE = /^(m\.?\s?[np]\.?\s*:?\s*\d|matr[ií]cula|mat\.|firma|validado|bioqu[ií]mic|p[aá]gina\s*\d|p[aá]gina\b|p[aá]g\.)/i
/** Matrícula profesional en cualquier parte del renglón. */
const LICENSE_ANYWHERE = /\b(m\.?\s?[np]\.?|matr[ií]cula|mat\.)\s*(n[°ºro.]*)?\s*:?\s*\d/i
/** "Hombres", "Mujeres", "Adultos:": a quién corresponde el valor de referencia que sigue. */
const POPULATION_LABEL =
  /^(hombres?|mujer(es)?|var[oó]n(es)?|masculino|femenino|adultos?|ni[ñn]os?|embarazadas?|reci[eé]n\s+nacidos?|neonatos?|ancianos?|premenop[aá]usicas?|postmenop[aá]usicas?|fumadores|no\s+fumadores)\s*:?$/i
/** Un renglón sin columnas y con muchas palabras es una frase, no un resultado. */
const PROSE_WORDS = 10
const METHOD_START = /^(m[eé]todo|muestra|tipo\s+de\s+muestra)\b/i
/** El texto antes del valor termina en una comparación: es un valor de referencia. */
const COMPARISON_TAIL = /(^| )((mayor|menor|igual|superior|inferior)( o igual)?( de| a| que)?|hasta|entre|desde|meta)$/
const NOT_A_NAME = new Set(['con', 'de', 'a', 'o', 'y', 'sin'])

interface RowDraft {
  analyte: string
  printedValue: string
  unit: string | null
  referenceRange: string | null
  needsReview?: string
}

function firstWordKey(name: string): string {
  return normalizeAnalyteKey(name).split(' ')[0] ?? ''
}

function validAnalyteName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_CHARS) return false
  if ((name.match(/\p{L}/gu)?.length ?? 0) < 2) return false
  // "Deseable: Menor de", "Hombres: mayor a": etiqueta de un valor de referencia.
  if (/:\s+\S/.test(name)) return false
  const key = normalizeAnalyteKey(name)
  if (NOT_A_NAME.has(key) || COMPARISON_TAIL.test(key)) return false
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

function isUnitText(text: string): boolean {
  if (text.length === 0 || text.length > MAX_UNIT_CHARS) return false
  if (!/[\p{L}%]/u.test(text) || text.startsWith('(') || text.includes(':')) return false
  if (/^(hasta|mayor|menor|entre|desde|de|a|y|o)\b/i.test(text)) return false
  if (/^\d[\d.,]*\s*(-|–|a|y)\s*\d/.test(text)) return false
  return !RANGE_PREFIX.test(`${text} `)
}

function isUnitCell(cell: string): boolean {
  return cell.length <= 12 && cell.split(/\s+/).length <= 2 && isUnitText(cell)
}

/** Número impreso, con su comparador si lo tiene, y lo que sigue pegado o separado. */
const LEADING_VALUE = /^((?:[<>≤≥]\s*)?\d(?:[\d.,]*\d)?)\s*(.*)$/

/** Interpreta el texto de una celda de resultado: "42 %", "57,1%", "6.800 por mm3", "< 0,5 ng/L", "Negativo". */
function parseValueText(text: string): { printedValue: string; unit: string | null; rest: string } | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  if (QUALITATIVE_ONLY.test(trimmed)) return { printedValue: trimmed.replace(/\.$/, ''), unit: null, rest: '' }
  const match = trimmed.match(LEADING_VALUE)
  if (!match) return null
  const printedValue = match[1]!
  const after = match[2]!
  // "70-100", "0 - 0.8 %", "70 a 99": un intervalo, no un resultado.
  if (/^(-|–|a\s|y\s)\s*\d/i.test(after)) return null
  // "24/09/2026", "08:02", "12-3456": fecha, hora o código.
  if (/^[/:.,-]\s*\d/.test(after)) return null

  // "mg/dl mg/dl": algunos informes repiten la unidad.
  let rest = after
    .split(/\s+/)
    .filter((token, index, list) => token.length > 0 && (index === 0 || token.toLowerCase() !== list[index - 1]!.toLowerCase()))
  let unit: string | null = null
  const joined = rest.join(' ')
  if (rest.length > 0 && rest.length <= 2 && isUnitText(joined)) {
    unit = joined
    rest = []
  } else if (rest[0] !== undefined && isUnitText(rest[0])) {
    unit = rest[0]
    rest = rest.slice(1)
  }
  return { printedValue, unit, rest: rest.join(' ') }
}

/** Intérprete por palabras, para renglones sin columnas. */
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
      const pattern = new RegExp(`\\${token}\\s*${tokens[index + 1]!.replace(/[.]/g, '\\.')}`)
      printedValue = line.match(pattern)?.[0] ?? null
      next = index + 2
    }
    if (printedValue === null) continue

    const analyte = tokens.slice(0, index).join(' ').replace(/[:\s]+$/, '')
    if (!validAnalyteName(analyte)) return null
    // "Normal: 70 a 99", "Niños: 0 - 0.8 %": un intervalo, no un resultado.
    const connector = tokens[next]
    const after = tokens[next + 1]
    if (connector !== undefined && after !== undefined && /^(-|–|a|y)$/i.test(connector) && /^\d/.test(after)) return null

    let unit: string | null = null
    const candidate = tokens[next]
    if (candidate !== undefined && !/^\d/.test(candidate) && !COMPARATOR.test(candidate) && isUnitText(candidate)) {
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

type Detected =
  | { kind: 'row'; drafts: RowDraft[]; needsTitle: boolean }
  | { kind: 'title'; text: string }
  | { kind: 'reference'; text: string | null }
  | { kind: 'other' }

function referenceFromCells(cells: string[]): string | null {
  return cleanRange(cells.filter((cell) => !METHOD_START.test(cell)).join(' '))
}

/** Qué es un renglón: un resultado, el título de un estudio, texto de referencia u otra cosa. */
function detectLine(rawLine: string): Detected {
  const cells = rawLine.split(TAB).map((cell) => cell.trim()).filter((cell) => cell.length > 0 && cell !== OMITTED)
  if (cells.length === 0) return { kind: 'other' }
  const whole = cells.join(' ')
  // Columna derecha de la hoja: valores de referencia, interpretación, firma.
  if (rawLine.startsWith(TAB)) return { kind: 'reference', text: whole }
  if (whole.length > MAX_LINE_CHARS || CONTACT_LINE.test(whole) || SIGNATURE_LINE.test(cells[0]!)) return { kind: 'other' }

  const first = cells[0]!
  if (ANNOTATION_FIRST_WORD.has(firstWordKey(first))) {
    return { kind: 'reference', text: cells.length > 1 ? cells.slice(1).join(' ') : null }
  }

  const label = first.match(LABEL_ROW)
  if (label) {
    const inline = label[2]!.trim()
    const value = parseValueText(inline.length > 0 ? inline : (cells[1] ?? ''))
    if (value) {
      const reference = [value.rest, ...cells.slice(inline.length > 0 ? 1 : 2)]
      return {
        kind: 'row',
        needsTitle: true,
        drafts: [{ analyte: label[1]!, printedValue: value.printedValue, unit: value.unit, referenceRange: referenceFromCells(reference) }],
      }
    }
    return { kind: 'other' }
  }

  if (cells.length === 1) {
    const draft = draftFromLine(first)
    if (draft) return { kind: 'row', needsTitle: false, drafts: [draft] }
    const text = first.replace(/[:\s]+$/, '')
    return text.length <= MAX_NAME_CHARS && (text.match(/\p{L}/gu)?.length ?? 0) >= 2 ? { kind: 'title', text } : { kind: 'other' }
  }

  // Tabla: analito | [:] | valor [unidad] | [unidad] | [segundo valor | unidad] | referencia
  const analyte = first.replace(/[:\s]+$/, '')
  const body = cells.slice(1).filter((cell) => cell !== ':')
  const value = parseValueText(body[0] ?? '')
  if (!value || !validAnalyteName(analyte)) return { kind: 'other' }

  let next = 1
  let unit = value.unit
  if (unit === null && value.rest.length === 0 && body[next] !== undefined && isUnitCell(body[next]!)) {
    unit = body[next]!
    next += 1
  }
  const drafts: RowDraft[] = [{ analyte, printedValue: value.printedValue, unit, referenceRange: null }]

  // Segundo valor del mismo analito en otra unidad: "57,1 % | 5093 /mm3".
  const second = parseValueText(body[next] ?? '')
  if (second && VALUE_TOKEN.test(second.printedValue) && second.rest.length === 0) {
    let secondUnit = second.unit
    let consumed = 1
    if (secondUnit === null && body[next + 1] !== undefined && isUnitCell(body[next + 1]!)) {
      secondUnit = body[next + 1]!
      consumed = 2
    }
    // Misma unidad que el resultado: es un valor de referencia suelto, no otro resultado.
    if (secondUnit !== null && secondUnit.toLowerCase() !== (unit ?? '').toLowerCase()) {
      drafts.push({ analyte: `${analyte} (${secondUnit})`, printedValue: second.printedValue, unit: secondUnit, referenceRange: null, needsReview: SECOND_VALUE_REASON })
      next += consumed
    }
  }
  drafts[0]!.referenceRange = referenceFromCells([value.rest, ...body.slice(next)])
  return { kind: 'row', needsTitle: false, drafts }
}

/**
 * Tapa los renglones que identifican a una persona en una transcripción ya
 * armada (la de una imagen), sin mover ningún renglón de lugar.
 */
export function redactIdentifyingLines(lines: readonly string[]): { lines: string[]; redacted: number } {
  let redacted = 0
  const out = lines.map((line) => {
    const cells = line.split(/\t| {2,}/)
    if (cells.some((cell) => IDENTIFYING_LINE.test(cell.trim()))) {
      redacted += 1
      return '[Renglón omitido]'
    }
    if (EMAIL.test(line)) {
      EMAIL.lastIndex = 0
      redacted += 1
      return line.replace(EMAIL, OMITTED)
    }
    EMAIL.lastIndex = 0
    return line
  })
  return { lines: out, redacted }
}

/** Renglón con números que no se pudo interpretar y que una persona debería mirar. */
function looksLikeUnreadResult(line: string): boolean {
  const cells = line.split(TAB).map((cell) => cell.trim()).filter((cell) => cell.length > 0 && !SIGNATURE_LINE.test(cell))
  const text = cells.join(' ')
  if (!/\d/.test(text) || CONTACT_LINE.test(text) || LICENSE_ANYWHERE.test(text)) return false
  return cells.length > 1 || text.split(/\s+/).length < PROSE_WORDS
}

export function parseLabReportText(rawText: string): ParsedLabReport {
  const source = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, MAX_LAB_REPORT_LINES)
    .map((line) => line.replace(/[ \t]+$/, ''))

  // Primer renglón de resultados: ahí termina el encabezado. Si el resultado
  // toma su nombre de un título anterior, el encabezado termina en ese título.
  let headerEnd = source.length
  let titleAt: number | null = null
  for (let index = 0; index < source.length; index += 1) {
    const detected = detectLine(source[index]!)
    if (detected.kind === 'title') titleAt = index
    else if (detected.kind === 'other') titleAt = source[index]!.trim().length === 0 ? titleAt : null
    else if (detected.kind === 'row') {
      headerEnd = detected.needsTitle && titleAt !== null ? titleAt : index
      break
    }
  }

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

  let pendingTitle: string | null = null
  /** Entre el título y su resultado hubo otra cosa (pie, salto de página): el nombre puede no ser el suyo. */
  let titleIsFar = false
  /** Fila que recibe los renglones de referencia que siguen, y cuántos lleva. */
  let openRow: ParsedLabRow | null = null
  let continuationCount = 0
  /** "Hombres", "Mujeres": se antepone al valor de referencia que sigue. */
  let populationLabel: string | null = null

  const markTruncated = (row: ParsedLabRow): void => {
    if (row.referenceRange !== null && !row.referenceRange.endsWith(MORE_MARK) && row.referenceRange.length + MORE_MARK.length <= MAX_RANGE_CHARS) {
      row.referenceRange += MORE_MARK
    }
  }

  const appendReference = (text: string | null): void => {
    if (text === null || openRow === null) return
    const bare = text.replace(RANGE_PREFIX, '').trim()
    if (METHOD_START.test(bare) || SIGNATURE_LINE.test(bare) || LICENSE_ANYWHERE.test(bare) || CONTACT_LINE.test(bare)) {
      populationLabel = null
      return
    }
    if (!/\d/.test(bare)) {
      populationLabel = POPULATION_LABEL.test(bare) ? bare.replace(/[:\s]+$/, '') : null
      return
    }
    const piece = populationLabel === null ? bare : `${populationLabel}: ${bare}`
    populationLabel = null
    if (continuationCount >= MAX_CONTINUATION_LINES) {
      markTruncated(openRow)
      return
    }
    const combined = openRow.referenceRange ? `${openRow.referenceRange} · ${piece}` : piece
    if (combined.length > MAX_RANGE_CHARS) {
      // No entra completo: se deja de sumar para no dejar fragmentos salteados,
      // y se avisa que la referencia sigue en el informe.
      continuationCount = MAX_CONTINUATION_LINES
      markTruncated(openRow)
      return
    }
    openRow.referenceRange = combined
    continuationCount += 1
  }

  for (let index = headerEnd; index < source.length; index += 1) {
    const original = source[index]!
    const trimmed = original.trim()
    if (trimmed.length === 0) {
      lines.push('')
      continue
    }
    // Encabezado repetido en otra página, o renglón con datos personales.
    const cells = original.split(TAB)
    const identifyingAt = cells.findIndex((cell) => IDENTIFYING_LINE.test(cell.trim()))
    const firstCellAt = cells.findIndex((cell) => cell.trim().length > 0)
    if (droppedHeader.has(normalizeAnalyteKey(trimmed)) || (identifyingAt !== -1 && identifyingAt <= firstCellAt)) {
      lines.push('[Renglón omitido]')
      piiRedactedCount += 1
      titleIsFar = true
      continue
    }
    let kept = original
    if (identifyingAt !== -1) {
      // El dato personal está en una columna posterior: se tapa desde ahí y el resultado se conserva.
      kept = [...cells.slice(0, identifyingAt), OMITTED].join(TAB)
      piiRedactedCount += 1
    }
    if (EMAIL.test(kept)) {
      kept = kept.replace(EMAIL, '[omitido]')
      piiRedactedCount += 1
    }
    EMAIL.lastIndex = 0

    const lineIndex = lines.push(kept) - 1
    const detected = detectLine(kept)

    if (detected.kind === 'reference') {
      appendReference(detected.text)
    } else if (detected.kind === 'title') {
      pendingTitle = detected.text
      titleIsFar = false
      openRow = null
    } else if (detected.kind === 'other') {
      openRow = null
      titleIsFar = true
      if (looksLikeUnreadResult(kept)) unparsedLines.push(lineIndex)
    } else {
      openRow = null
      continuationCount = 0
      populationLabel = null
      for (const draft of detected.drafts) {
        if (rows.length >= MAX_LAB_REPORT_ROWS) break
        let analyte = draft.analyte
        let reason = draft.needsReview ?? null
        if (detected.needsTitle) {
          if (pendingTitle !== null && validAnalyteName(pendingTitle)) {
            analyte = pendingTitle
            if (titleIsFar) reason = FAR_TITLE_REASON
          } else {
            reason = NO_TITLE_REASON
          }
        }
        const { value, ambiguous } = parsePrintedNumber(draft.printedValue)
        reason = ambiguous ? AMBIGUOUS_REASON : (reason ?? (analyte.length > LONG_NAME_CHARS ? LONG_NAME_REASON : null))
        const row: ParsedLabRow = {
          analyte,
          printedValue: draft.printedValue,
          value,
          unit: draft.unit,
          referenceRange: draft.referenceRange,
          sourceLine: lineIndex,
          needsReview: reason !== null,
          reviewReason: reason,
        }
        rows.push(row)
        openRow ??= row
      }
      // "Ferritina | 80 | ng/mL | Hombres:" — la etiqueta vale para el renglón que sigue.
      const lastCell = kept.split(TAB).pop()?.trim() ?? ''
      if (POPULATION_LABEL.test(lastCell)) populationLabel = lastCell.replace(/[:\s]+$/, '')
      pendingTitle = null
    }
  }

  return { transcription: lines.join('\n'), lines, rows, unparsedLines, piiRedactedCount }
}
