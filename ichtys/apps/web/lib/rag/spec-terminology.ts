import { lookupTerminology, type TerminologySuggestion } from '@ichtys/rag/medical-annotator'
import type { StudySpec } from '@ichtys/ingestion/study-spec'

/**
 * spec-terminology.ts — extrae y lee códigos SNOMED-CT / LOINC de study specs.
 */

export function extractSpecTerminology(spec: StudySpec): TerminologySuggestion[] {
  const texts: string[] = []
  for (const c of spec.inclusionCriteria) texts.push(c.text)
  for (const c of spec.exclusionCriteria) texts.push(c.text)
  for (const e of spec.endpoints) {
    texts.push(e.objective)
    texts.push(e.endpoint)
  }
  return lookupTerminology(texts.join('\n'))
}

/** Valida un array JSONB de terminology_annotations desde la columna dedicada. */
export function parseTerminologyAnnotations(value: unknown): TerminologySuggestion[] | null {
  if (!Array.isArray(value)) return null
  const parsed = value.filter(
    (v): v is TerminologySuggestion =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as TerminologySuggestion).code === 'string' &&
      typeof (v as TerminologySuggestion).system === 'string' &&
      typeof (v as TerminologySuggestion).display === 'string',
  )
  return parsed.length > 0 ? parsed : null
}

/**
 * Fallback legacy: lee anotaciones embebidas en spec jsonb (pre-migración 0004).
 * @deprecated Preferir columna study_specs.terminology_annotations
 */
export function readLegacySpecTerminology(rawSpec: unknown): TerminologySuggestion[] | null {
  if (typeof rawSpec !== 'object' || rawSpec === null) return null
  const value = (rawSpec as Record<string, unknown>)['terminologyAnnotations']
  return parseTerminologyAnnotations(value)
}
