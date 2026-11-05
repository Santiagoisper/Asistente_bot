import { z } from 'zod'
import {
  eligibilityCriterionSchema,
  studyEndpointSchema,
  studyIdentificationSchema,
  studyVisitSchema,
  studySpecSchema,
  MAX_SPEC_ITEMS,
  MAX_SPEC_VISIT_PROCEDURES,
  MAX_SPEC_SOURCE_PAGES,
  MAX_SPEC_TEXT_CHARS,
  MAX_SPEC_NUMBER_CHARS,
  MAX_SPEC_VISIT_LABEL_CHARS,
  MAX_SPEC_IDENTIFICATION_CHARS,
  MAX_SPEC_PROCEDURE_CHARS,
  MAX_SPEC_EXTRACTION_WARNINGS,
  MAX_SPEC_WARNING_CHARS,
  type EligibilityCriterion,
  type StudyEndpoint,
  type StudyIdentification,
  type StudySpec,
  type StudyVisit,
} from './study-spec'

/**
 * spec-normalizer.ts — normaliza la salida del modelo ANTES de las cotas.
 *
 * Las cotas de studySpecSchema protegen la entrada HTTP (PATCH de spec), pero
 * el MISMO schema valida la salida del modelo: sin este normalizador, un solo
 * ítem largo (un procedimiento de 601 chars, 101 sourcePages, un criterio de
 * 10.001) tumba la extracción completa (regresión E5, bloqueante de la vuelta
 * 4). Contrato: un tope NUNCA hace fallar más que el ítem afectado —
 *
 *   - ítem que ya valida: se guarda tal cual, sin advertencias;
 *   - ítem reparable (texto o arreglo por encima del tope, número no entero):
 *     se recorta y se registra UNA advertencia por ítem con lo ajustado;
 *   - ítem insalvable (sin provenance, confidence inválida): se descarta con
 *     advertencia, sin tumbar al resto.
 *
 * El normalizador nunca inventa contenido semántico: enums (confidence, type)
 * y textos no se traducen ni parafrasean — solo se recortan al tope.
 */

/** Recorta un string al tope (sin tocarlo si ya cabe). */
function clipString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  return value.length > max ? value.slice(0, max) : value
}

/** Filtra páginas válidas (enteros positivos) y recorta al tope. [] si no hay ninguna. */
function clipPages(value: unknown, max: number): number[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((page): page is number => Number.isInteger(page) && page > 0)
    .slice(0, max)
}

type JsonRecord = Record<string, unknown>

/**
 * Pipeline por ítem: validar → reparar → validar → descartar.
 * Devuelve el ítem (original o reparado) o null si es insalvable.
 */
function repairItem<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  describe: string,
  repair: (item: JsonRecord) => { value: JsonRecord; adjustments: string[] } | null,
  warnings: string[],
): T | null {
  const first = schema.safeParse(raw)
  if (first.success) return first.data

  if (typeof raw !== 'object' || raw === null) {
    warnings.push(`${describe}: descartado — la salida del modelo no es un objeto`)
    return null
  }
  const repaired = repair(raw as JsonRecord)
  if (repaired) {
    const second = schema.safeParse(repaired.value)
    if (second.success) {
      // Decisión del Foreman (N1/O2, vuelta 5): un ítem REPARADO lleva la
      // marca de la reparación — su confidence baja a 'low', la insignia por
      // ítem que la pantalla ya muestra. El contenido no se toca.
      const data = second.data as T & { confidence?: unknown }
      const hasConfidence = 'confidence' in data
      const adjusted = (hasConfidence ? { ...data, confidence: 'low' } : data) as T
      const notes = hasConfidence ? [...repaired.adjustments, "confidence bajada a 'low' (ítem reparado)"] : repaired.adjustments
      warnings.push(`${describe}: ${notes.join('; ')}`)
      return adjusted
    }
  }
  warnings.push(`${describe}: descartado — no se pudo ajustar a las cotas del spec`)
  return null
}

/** Número entero o null (para day/windowDays, que son nullable). */
function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Ítems
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeCriterion(
  raw: unknown,
  label: string,
  warnings: string[],
): EligibilityCriterion | null {
  return repairItem(eligibilityCriterionSchema, raw, label, (item) => {
    const number = clipString(item.number, MAX_SPEC_NUMBER_CHARS)
    const text = clipString(item.text, MAX_SPEC_TEXT_CHARS)
    const sourcePages = clipPages(item.sourcePages, MAX_SPEC_SOURCE_PAGES)
    if (!number || !text || sourcePages.length === 0) return null
    const adjustments: string[] = []
    if (item.number !== number) adjustments.push(`número recortado a ${number.length} chars`)
    if (item.text !== text) adjustments.push(`texto recortado a ${MAX_SPEC_TEXT_CHARS} chars`)
    if (sourcePages.length !== (item.sourcePages as unknown[])?.length) {
      adjustments.push(`sourcePages recortadas a ${sourcePages.length}`)
    }
    return { value: { number, text, sourcePages, confidence: item.confidence }, adjustments }
  }, warnings)
}

export function normalizeEndpoint(
  raw: unknown,
  label: string,
  warnings: string[],
): StudyEndpoint | null {
  return repairItem(studyEndpointSchema, raw, label, (item) => {
    const objective = clipString(item.objective, MAX_SPEC_TEXT_CHARS)
    const endpoint = clipString(item.endpoint, MAX_SPEC_TEXT_CHARS)
    const sourcePages = clipPages(item.sourcePages, MAX_SPEC_SOURCE_PAGES)
    if (!objective || !endpoint || sourcePages.length === 0) return null
    const adjustments: string[] = []
    if (item.objective !== objective) adjustments.push(`objetivo recortado a ${MAX_SPEC_TEXT_CHARS} chars`)
    if (item.endpoint !== endpoint) adjustments.push(`endpoint recortado a ${MAX_SPEC_TEXT_CHARS} chars`)
    if (sourcePages.length !== (item.sourcePages as unknown[])?.length) {
      adjustments.push(`sourcePages recortadas a ${sourcePages.length}`)
    }
    return { value: { type: item.type, objective, endpoint, sourcePages, confidence: item.confidence }, adjustments }
  }, warnings)
}

export function normalizeVisit(raw: unknown, label: string, warnings: string[]): StudyVisit | null {
  // G4-S1: el label lo arma el llamador con la posición del ítem («visita #7») —
  // la advertencia nunca copia name ni ningún campo del documento/modelo.
  return repairItem(studyVisitSchema, raw, label, (item) => {
    const visitName = clipString(item.name, MAX_SPEC_VISIT_LABEL_CHARS)
    if (!visitName) return null
    const visitLabel =
      item.label === null || item.label === undefined
        ? null
        : clipString(item.label, MAX_SPEC_VISIT_LABEL_CHARS) ?? null
    const sourcePages = clipPages(item.sourcePages, MAX_SPEC_SOURCE_PAGES)
    if (sourcePages.length === 0) return null
    // day / windowDays son nullable: un valor no entero o una ventana negativa
    // se reparan a null (mismo criterio que validateExtractedVisits), no
    // descartan la visita.
    const day = item.day === null || item.day === undefined ? null : integerOrNull(item.day)
    const rawWindow = item.windowDays
    const rawWindowNumber = typeof rawWindow === 'number' ? rawWindow : null
    const windowDays =
      rawWindow === null || rawWindow === undefined
        ? null
        : rawWindowNumber !== null && Number.isInteger(rawWindowNumber) && rawWindowNumber >= 0
          ? rawWindowNumber
          : null
    const procedures = Array.isArray(item.procedures)
      ? item.procedures
          .filter((procedure): procedure is string => typeof procedure === 'string' && procedure.trim() !== '')
          .map((procedure) =>
            procedure.length > MAX_SPEC_PROCEDURE_CHARS
              ? procedure.slice(0, MAX_SPEC_PROCEDURE_CHARS)
              : procedure,
          )
          .slice(0, MAX_SPEC_VISIT_PROCEDURES)
      : []
    const adjustments: string[] = []
    if (item.name !== visitName) adjustments.push(`nombre recortado a ${MAX_SPEC_VISIT_LABEL_CHARS} chars`)
    if (typeof item.label === 'string' && item.label !== visitLabel) {
      adjustments.push(`label recortado a ${MAX_SPEC_VISIT_LABEL_CHARS} chars`)
    }
    if (item.day !== undefined && item.day !== null && day === null) adjustments.push('has a non-integer study day → null')
    if (rawWindow !== undefined && rawWindow !== null && windowDays === null) {
      adjustments.push('has an invalid visit window → null')
    }
    const rawProcedures = (item.procedures as unknown[] | undefined) ?? []
    if (
      procedures.length !== rawProcedures.length ||
      procedures.some((procedure, index) => procedure !== rawProcedures[index])
    ) {
      adjustments.push(`procedimientos recortados a ${procedures.length}`)
    }
    const rawPages = (item.sourcePages as unknown[] | undefined) ?? []
    if (
      sourcePages.length !== rawPages.length ||
      sourcePages.some((page, index) => page !== rawPages[index])
    ) {
      adjustments.push(`sourcePages recortadas a ${sourcePages.length}`)
    }
    return {
      value: { name: visitName, label: visitLabel, day, windowDays, procedures, sourcePages, confidence: item.confidence },
      adjustments,
    }
  }, warnings)
}

export function normalizeIdentification(
  raw: unknown,
  warnings: string[],
): StudyIdentification {
  const repaired = repairItem(studyIdentificationSchema, raw, 'identification', (item) => {
    const clip = (field: unknown): string | null => {
      if (field === null || field === undefined) return null
      const clipped = clipString(field, MAX_SPEC_IDENTIFICATION_CHARS)
      return clipped === '' ? null : clipped
    }
    const sourcePages = clipPages(item.sourcePages, MAX_SPEC_SOURCE_PAGES)
    const adjustments: string[] = []
    for (const field of ['protocolCode', 'title', 'phase'] as const) {
      const original = item[field]
      const clipped = clip(original)
      if (typeof original === 'string' && original !== clipped && clipped !== null) {
        adjustments.push(`${field} recortado a ${MAX_SPEC_IDENTIFICATION_CHARS} chars`)
      }
      if (typeof original !== 'string' && original !== null && original !== undefined) {
        adjustments.push(`${field} no es un string → null`)
      }
    }
    if (sourcePages.length !== (item.sourcePages as unknown[])?.length) {
      adjustments.push(`sourcePages recortadas a ${sourcePages.length}`)
    }
    return {
      value: {
        protocolCode: clip(item.protocolCode),
        title: clip(item.title),
        phase: clip(item.phase),
        sourcePages,
      },
      adjustments,
    }
  }, warnings)
  // La identificación no se descarta entera: sin ella no hay spec mínimo.
  return repaired ?? { protocolCode: null, title: null, phase: null, sourcePages: [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grupos (shape de los schemas de extracción) y spec completo
// ─────────────────────────────────────────────────────────────────────────────

function normalizeList<T>(
  raw: unknown,
  max: number,
  label: string,
  normalizeOne: (item: unknown, index: number, warnings: string[]) => T | null,
  warnings: string[],
): T[] {
  // B1 (vuelta 5): una lista ausente o no-arreglo devuelve [] PERO nombrada.
  // Sin esto, la recuperación de una salida parcial del SDK («solo vino
  // inclusionCriteria») dejaba exclusionCriteria = [] en silencio, que en
  // pantalla se lee como «este protocolo no tiene criterios de exclusión».
  if (!Array.isArray(raw)) {
    warnings.push(`${label}: ausente o inválido en la salida del modelo — 0 ítems`)
    return []
  }
  const items = raw
    .map((item, index) => normalizeOne(item, index, warnings))
    .filter((item): item is T => item !== null)
  if (items.length > max) {
    warnings.push(`${label}: ${items.length} ítems recortados a ${max}`)
    return items.slice(0, max)
  }
  return items
}

export function normalizeEligibilityGroup(
  raw: unknown,
  warnings: string[],
): { inclusionCriteria: EligibilityCriterion[]; exclusionCriteria: EligibilityCriterion[] } {
  const group = (typeof raw === 'object' && raw !== null ? raw : {}) as JsonRecord
  return {
    inclusionCriteria: normalizeList(
      group.inclusionCriteria, MAX_SPEC_ITEMS, 'eligibility: inclusion',
      (item, index, w) => normalizeCriterion(item, `eligibility: inclusión criterio #${index + 1}`, w), warnings,
    ),
    exclusionCriteria: normalizeList(
      group.exclusionCriteria, MAX_SPEC_ITEMS, 'eligibility: exclusion',
      (item, index, w) => normalizeCriterion(item, `eligibility: exclusión criterio #${index + 1}`, w), warnings,
    ),
  }
}

export function normalizeEndpointsGroup(
  raw: unknown,
  warnings: string[],
): { endpoints: StudyEndpoint[] } {
  const group = (typeof raw === 'object' && raw !== null ? raw : {}) as JsonRecord
  return {
    endpoints: normalizeList(
      group.endpoints, MAX_SPEC_ITEMS, 'endpoints',
      (item, index, w) => normalizeEndpoint(item, `endpoints: endpoint #${index + 1}`, w), warnings,
    ),
  }
}

export function normalizeVisitsGroup(
  raw: unknown,
  warnings: string[],
): { visits: StudyVisit[] } {
  const group = (typeof raw === 'object' && raw !== null ? raw : {}) as JsonRecord
  return {
    visits: normalizeList(
      group.visits, MAX_SPEC_ITEMS, 'visits',
      (item, index, w) => normalizeVisit(item, `visits: visita #${index + 1}`, w), warnings,
    ),
  }
}

/** ¿Advertencia de descarte o recuperación? Se priorizan al recortar (B2). */
function isPriorityWarning(warning: string): boolean {
  return warning.includes('descartado') || warning.includes('recuperada')
}

/**
 * Cierra la lista de advertencias a las cotas (B2, vuelta 5): recorta cada
 * una a 1000 chars y, si hay más de 200, conserva primero descartes y
 * recuperaciones (las que el revisor clínico debe ver sí o sí) y deja la
 * última entrada como «… y N advertencias más». Antes el recorte conservaba
 * las primeras 200 — justo las de descarte, que se agregan al final, se
 * perdían.
 */
export function capExtractionWarnings(list: readonly unknown[]): string[] {
  const clipped = list
    .map((warning) => clipString(warning, MAX_SPEC_WARNING_CHARS) ?? '')
    .filter((warning) => warning.length > 0)
  if (clipped.length <= MAX_SPEC_EXTRACTION_WARNINGS) return clipped
  const kept = [
    ...clipped.filter(isPriorityWarning),
    ...clipped.filter((warning) => !isPriorityWarning(warning)),
  ].slice(0, MAX_SPEC_EXTRACTION_WARNINGS - 1)
  const omitted = clipped.length - kept.length
  kept.push(`… y ${omitted} advertencia${omitted === 1 ? '' : 's'} más`)
  return kept
}

/**
 * Códigos que este módulo (y el extractor) generan antes de los dos puntos.
 * La lista es blanca a propósito: un prefijo desconocido puede ser texto del
 * modelo o del documento, y los logs sólo llevan códigos y conteos (G4-S1).
 */
const WARNING_CODE_WHITELIST: ReadonlySet<string> = new Set([
  'identification',
  'eligibility',
  'endpoints',
  'visits',
  'locator',
  'section-location',
  'extractionWarnings',
])

/** Resumen «código×N» de advertencias para logs: conteos y códigos, sin contenido (G4-S1). */
export function warningCodeSummary(warnings: string[]): string {
  const counts = new Map<string, number>()
  for (const warning of warnings) {
    const rawCode = (warning.split(':', 1)[0] ?? '').trim()
    const code = WARNING_CODE_WHITELIST.has(rawCode) ? rawCode : 'otros'
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([code, count]) => `${code}×${count}`).join(', ')
}

/**
 * Normaliza un spec completo (grupos + extractionWarnings). Es la defensa
 * final antes de studySpecSchema.parse: idempotente sobre un spec válido
 * (0 advertencias) y garantiza que el parse no pueda fallar por cotas.
 */
export function normalizeStudySpec(raw: unknown, warnings: string[]): StudySpec {
  const spec = (typeof raw === 'object' && raw !== null ? raw : {}) as JsonRecord
  const rawWarnings = Array.isArray(spec.extractionWarnings)
    ? spec.extractionWarnings
    : []
  const clippedWarnings = capExtractionWarnings(rawWarnings)
  const overLength = rawWarnings.some(
    (warning) => typeof warning === 'string' && warning.length > MAX_SPEC_WARNING_CHARS,
  )
  if (clippedWarnings.length < rawWarnings.length || overLength) {
    warnings.push(
      `extractionWarnings: ${rawWarnings.length} advertencias recortadas al tope de ${MAX_SPEC_EXTRACTION_WARNINGS}`,
    )
  }

  const identification = normalizeIdentification(spec.identification, warnings)
  const inclusionCriteria = normalizeList(
    spec.inclusionCriteria, MAX_SPEC_ITEMS, 'eligibility: inclusion',
    (item, index, w) => normalizeCriterion(item, `eligibility: inclusión criterio #${index + 1}`, w), warnings,
  )
  const exclusionCriteria = normalizeList(
    spec.exclusionCriteria, MAX_SPEC_ITEMS, 'eligibility: exclusion',
    (item, index, w) => normalizeCriterion(item, `eligibility: exclusión criterio #${index + 1}`, w), warnings,
  )
  const endpoints = normalizeList(
    spec.endpoints, MAX_SPEC_ITEMS, 'endpoints',
    (item, index, w) => normalizeEndpoint(item, `endpoints: endpoint #${index + 1}`, w), warnings,
  )
  const visits = normalizeList(
    spec.visits, MAX_SPEC_ITEMS, 'visits',
    (item, index, w) => normalizeVisit(item, `visits: visita #${index + 1}`, w), warnings,
  )

  const normalized = {
    identification,
    inclusionCriteria,
    exclusionCriteria,
    endpoints,
    visits,
    ...(typeof spec.visitsSource === 'object' && spec.visitsSource !== null
      ? { visitsSource: spec.visitsSource }
      : {}),
    ...(typeof spec.extractionFailed === 'boolean' ? { extractionFailed: spec.extractionFailed } : {}),
    ...(clippedWarnings.length > 0 ? { extractionWarnings: clippedWarnings } : {}),
  }
  return studySpecSchema.parse(normalized)
}
