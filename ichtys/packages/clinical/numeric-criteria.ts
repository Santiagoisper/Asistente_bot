/**
 * Umbrales numéricos de criterios (ADR-7 §2.1). Puro: sin reloj, sin red.
 * La coma decimal se normaliza solo cuando hay 1 o 2 decimales; "1,000"
 * (miles) no se toca. Cada cota conserva su operador. Laboratorio y
 * criterio se comparan en la unidad del criterio.
 */

export type AnalyteId = 'HbA1c' | 'eGFR' | 'BMI'

export type AnalyteUnit = '%' | 'mmol/mol' | 'mL/min' | 'kg/m2'

export interface NumericBound {
  value: number
  inclusive: boolean
}

export interface AnalyteBounds {
  min?: NumericBound
  max?: NumericBound
  unit: AnalyteUnit
  /** Presente cuando el rango no traía operador y se asumió inclusivo. */
  warning?: string
}

/** NGSP% = 0.09148 × IFCC(mmol/mol) + 2.152. Ecuación maestra NGSP/IFCC. */
export const NGSP_FROM_IFCC_SLOPE = 0.09148
export const NGSP_FROM_IFCC_INTERCEPT = 2.152

const RANGE_WARNING = 'rango sin operador: se asumió inclusivo'

const ANALYTE_ALIASES: Record<AnalyteId, RegExp> = {
  HbA1c: /HbA1c|\bA1c\b|hemoglobina glicosilada|glycated hemoglobin/i,
  eGFR: /\beGFR\b|\bTFG\b|filtrado glomerular/i,
  BMI: /\bBMI\b|\bIMC\b|índice de masa corporal|indice de masa corporal|body mass index/i,
}

/**
 * Cambia cada coma decimal (`7,0`, `10,5`) por punto. No toca un separador
 * de miles (`1,000`): después de la coma hay tres dígitos.
 */
export function normalizeDecimalCommas(text: string): string {
  return text.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
}

export function ifccMmolToNgsp(mmolPerMol: number): number {
  return NGSP_FROM_IFCC_SLOPE * mmolPerMol + NGSP_FROM_IFCC_INTERCEPT
}

export function ngspToIfccMmol(percent: number): number {
  return (percent - NGSP_FROM_IFCC_INTERCEPT) / NGSP_FROM_IFCC_SLOPE
}

export function textMentionsAnalyte(text: string, analyte: AnalyteId): boolean {
  return ANALYTE_ALIASES[analyte].test(text)
}

interface ClassifiedOp {
  side: 'min' | 'max'
  inclusive: boolean
}

function classifyOperator(op: string): ClassifiedOp {
  const normalized = op.toLowerCase()
  if (/mayor o igual|al menos|at least|≥|>=/.test(normalized)) return { side: 'min', inclusive: true }
  if (/mayor(?:es)? (?:que|de|a)\b|superior a|more than/.test(normalized) || normalized === '>') {
    return { side: 'min', inclusive: false }
  }
  if (/menor o igual|no m[aá]s de|no more than|at most|hasta|≤|<=/.test(normalized)) {
    return { side: 'max', inclusive: true }
  }
  return { side: 'max', inclusive: false }
}

function parseBoundNumber(raw: string): number {
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) return Number(raw.replace(/,/g, ''))
  return Number(raw)
}

const BOUND_RE =
  /(mayor o igual(?: a)?|menor o igual(?: a)?|al menos|at least|no m[aá]s de|no more than|at most|mayor(?:es)? (?:que|de|a)|superior a|more than|menor(?:es)? (?:que|de|a)|inferior a|less than|hasta|≥|>=|≤|<=|>|<)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/gi

function operatorBounds(text: string): { min?: NumericBound; max?: NumericBound } {
  const found: { min?: NumericBound; max?: NumericBound } = {}
  for (const match of text.matchAll(BOUND_RE)) {
    const classified = classifyOperator(match[1] ?? '')
    if (found[classified.side]) continue
    found[classified.side] = {
      value: parseBoundNumber(match[2] ?? ''),
      inclusive: classified.inclusive,
    }
  }
  return found
}

function bareRange(text: string): { min: NumericBound; max: NumericBound } | null {
  // Entre los dos números puede venir la unidad: «entre 7.0 % y 10.5 %».
  const entre = text.match(/entre\s+(\d+(?:\.\d+)?)\s*(?:%|[a-zA-Z][a-zA-Z0-9/²%.]{0,13})?\s+y\s+(\d+(?:\.\d+)?)/i)
  const to = text.match(/(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i)
  const dash = text.match(/(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)/)
  const match = entre ?? to ?? dash
  if (!match) return null
  const low = Number(match[1])
  const high = Number(match[2])
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null
  return {
    min: { value: low, inclusive: true },
    max: { value: high, inclusive: true },
  }
}

function detectUnit(text: string, analyte: AnalyteId): AnalyteUnit {
  if (analyte === 'HbA1c') {
    if (/mmol\s*\/\s*mol/i.test(text)) return 'mmol/mol'
    return '%'
  }
  if (analyte === 'eGFR') return 'mL/min'
  return 'kg/m2'
}

/** Cotas del criterio para un analito. `null` si el texto no habla de ese analito o no hay números. */
export function parseAnalyteBounds(text: string, analyte: AnalyteId): AnalyteBounds | null {
  if (!textMentionsAnalyte(text, analyte)) return null
  const normalized = normalizeDecimalCommas(text)
  const fromOps = operatorBounds(normalized)
  let warning: string | undefined
  let min = fromOps.min
  let max = fromOps.max
  if (!min && !max) {
    const range = bareRange(normalized)
    if (!range) return null
    min = range.min
    max = range.max
    warning = RANGE_WARNING
  }
  return { min, max, unit: detectUnit(text, analyte), warning }
}

export function compareWithBounds(value: number, bounds: AnalyteBounds): boolean {
  if (bounds.min) {
    const ok = bounds.min.inclusive ? value >= bounds.min.value : value > bounds.min.value
    if (!ok) return false
  }
  if (bounds.max) {
    const ok = bounds.max.inclusive ? value <= bounds.max.value : value < bounds.max.value
    if (!ok) return false
  }
  return bounds.min !== undefined || bounds.max !== undefined
}

export interface AlignedLab {
  value: number
  unit: AnalyteUnit
  /** Texto listo para el motivo, en la unidad del criterio. */
  display: string
}

export type AlignLabResult = AlignedLab | { unknown: string }

function canonicalLabUnit(unit: string | undefined): AnalyteUnit | 'other' | undefined {
  if (unit === undefined || unit.trim() === '') return undefined
  const compact = unit.trim().toLowerCase().replace(/\s+/g, '')
  if (compact === '%' || compact === 'percent' || compact === 'ngsp') return '%'
  if (compact.includes('mmol')) return 'mmol/mol'
  if (compact.includes('ml/min')) return 'mL/min'
  if (compact.includes('kg/m')) return 'kg/m2'
  return 'other'
}

/**
 * Lleva el laboratorio a la unidad del criterio. Sin unidad, se asume `%`
 * solo si el valor está entre 3 y 20; si no, `unknown` con motivo.
 */
export function alignLabToBounds(
  labValue: number,
  labUnit: string | undefined,
  bounds: AnalyteBounds,
): AlignLabResult {
  let unit = canonicalLabUnit(labUnit)
  if (unit === undefined) {
    if (labValue < 3 || labValue > 20) {
      return { unknown: `valor ${formatClinicalNumber(labValue)} sin unidad: no se asume % fuera de 3–20.` }
    }
    unit = '%'
  }
  if (unit === 'other' || (unit !== bounds.unit && unit !== '%' && unit !== 'mmol/mol')) {
    return { unknown: `unidad del laboratorio (${labUnit}) no se puede comparar con ${bounds.unit}.` }
  }
  if (unit === bounds.unit) {
    return { value: labValue, unit, display: `${formatClinicalNumber(labValue)} ${unit}` }
  }
  if (bounds.unit === '%' && unit === 'mmol/mol') {
    const ngsp = ifccMmolToNgsp(labValue)
    return { value: ngsp, unit: '%', display: `${formatClinicalNumber(ngsp)} %` }
  }
  if (bounds.unit === 'mmol/mol' && unit === '%') {
    const ifcc = ngspToIfccMmol(labValue)
    return { value: ifcc, unit: 'mmol/mol', display: `${formatClinicalNumber(ifcc)} mmol/mol` }
  }
  return { unknown: `unidad del laboratorio (${labUnit}) no se puede comparar con ${bounds.unit}.` }
}

export function formatClinicalNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return rounded.toFixed(1).replace('.', ',')
}

function boundClause(
  analyte: AnalyteId,
  display: string,
  side: 'min' | 'max',
  bound: NumericBound,
  unit: AnalyteUnit,
): string {
  const symbol = side === 'min' ? (bound.inclusive ? '≥' : '>') : bound.inclusive ? '≤' : '<'
  const kind = side === 'min' ? 'mínimo' : 'máximo'
  const mode = bound.inclusive ? 'inclusivo' : 'estricto'
  return `${analyte} ${display} ${symbol} ${formatClinicalNumber(bound.value)} ${unit} (${kind} ${mode})`
}

function sideFails(value: number, side: 'min' | 'max', bound: NumericBound): boolean {
  if (side === 'min') return bound.inclusive ? value < bound.value : value <= bound.value
  return bound.inclusive ? value > bound.value : value >= bound.value
}

/**
 * Cota que se cita cuando se cita una sola: la que no se cumple (mínimo primero), o la única
 * que el criterio trae. Un rango cumplido cita las dos (ver `describeBoundComparison`).
 */
function citedSide(value: number, bounds: AnalyteBounds, satisfies: boolean): 'min' | 'max' | null {
  if (!satisfies) {
    if (bounds.min && sideFails(value, 'min', bounds.min)) return 'min'
    if (bounds.max && sideFails(value, 'max', bounds.max)) return 'max'
  }
  if (bounds.max) return 'max'
  if (bounds.min) return 'min'
  return null
}

/**
 * Motivo que cita el valor ya convertido (en la unidad del criterio) y la cota que decide.
 * Si el criterio es un rango y el valor está adentro, deciden las dos cotas y se citan las
 * dos: «HbA1c 7,9 % ≥ 7,0 % (mínimo inclusivo) y ≤ 10,5 % (máximo inclusivo)».
 */
export function describeBoundComparison(
  analyte: AnalyteId,
  valueInCriterionUnit: number,
  bounds: AnalyteBounds,
  satisfies: boolean,
): string {
  const display = `${formatClinicalNumber(valueInCriterionUnit)} ${bounds.unit}`
  if (satisfies && bounds.min && bounds.max) {
    const low = boundClause(analyte, display, 'min', bounds.min, bounds.unit)
    const high = boundClause(analyte, display, 'max', bounds.max, bounds.unit).slice(`${analyte} ${display} `.length)
    const both = `${low} y ${high}`
    return bounds.warning ? `${both}. ${bounds.warning}` : both
  }
  const side = citedSide(valueInCriterionUnit, bounds, satisfies)
  const bound = side === 'min' ? bounds.min : side === 'max' ? bounds.max : undefined
  if (!bound || !side) return `${analyte} ${display}`
  const clause = boundClause(analyte, display, side, bound, bounds.unit)
  return bounds.warning ? `${clause}. ${bounds.warning}` : clause
}

/**
 * Cotas de edad de un criterio («adultos de 18 a 75 años», «mayores de 18
 * años», «edad mayor o igual a 18 años»). `null` si el texto no es un criterio
 * de edad.
 *
 * Regla: el número tiene que llevar «años» pegado. Una palabra de población
 * («adultos») no alcanza: «adultos con IMC entre 23 y 40» no es una edad. Y
 * «años» que mide un plazo («2 años de evolución», «durante 5 años») tampoco.
 */
const YEARS = '(?:a[nñ]os|years?)'
const DURATION_AFTER = new RegExp(`^\\s*${YEARS}\\s+de\\s+(?!edad)`, 'i')
const DURATION_BEFORE = /(?:durante|desde hace|hace|por|[uú]ltimos|previos|pasados)\s+(?:al menos\s+|m[aá]s de\s+)?$/i
const DURATION_WORDS = /evoluci[oó]n|diagn[oó]stic|tratamiento|duraci[oó]n|antig[uü]edad|seguimiento|\bdesde\b|\bdurante\b|\bhace\b|[uú]ltimos|previos|\bantes\b/i
const EXPLICIT_AGE = /\bedad\b|\bage\b|years of age|\baged\b/i

export function parseAgeBounds(text: string): { min?: NumericBound; max?: NumericBound } | null {
  const normalized = normalizeDecimalCommas(text)
  const range = new RegExp(
    `(\\d{1,3})\\s*(?:${YEARS})?\\s*(?:a|y|to|[–—-])\\s*(\\d{1,3})(?=\\s*${YEARS})`,
    'i',
  ).exec(normalized)
  if (range) {
    const low = Number(range[1])
    const high = Number(range[2])
    const after = normalized.slice(range.index + range[0].length)
    const before = normalized.slice(0, range.index)
    if (low > high || high > 120) return null
    if (DURATION_AFTER.test(after) || DURATION_BEFORE.test(before)) return null
    return { min: { value: low, inclusive: true }, max: { value: high, inclusive: true } }
  }
  // Cota con operador: el número lleva «años» pegado y el texto no habla de un plazo,
  // salvo que nombre la edad de forma expresa.
  const found: { min?: NumericBound; max?: NumericBound } = {}
  for (const match of normalized.matchAll(BOUND_RE)) {
    const end = (match.index ?? 0) + match[0].length
    if (!new RegExp(`^\\s*${YEARS}\\b`, 'i').test(normalized.slice(end))) continue
    if (DURATION_AFTER.test(normalized.slice(end))) continue
    const classified = classifyOperator(match[1] ?? '')
    if (found[classified.side]) continue
    found[classified.side] = { value: parseBoundNumber(match[2] ?? ''), inclusive: classified.inclusive }
  }
  if (!found.min && !found.max) return null
  if (!EXPLICIT_AGE.test(normalized) && DURATION_WORDS.test(normalized)) return null
  if ((found.min?.value ?? 0) > 120 || (found.max?.value ?? 0) > 120) return null
  return found
}
