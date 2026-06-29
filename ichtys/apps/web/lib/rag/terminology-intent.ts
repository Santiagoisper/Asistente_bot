import { lookupTerminology, type TerminologySuggestion } from '@ichtys/rag/medical-annotator'

/**
 * terminology-intent.ts — detección de preguntas de codificación clínica.
 *
 * Cuando el usuario pregunta por el código SNOMED-CT / LOINC de un concepto
 * (ej. "¿podés asociar diabetes tipo 1 a un código SNOMED-CT?"), el RAG puro
 * responde "evidencia insuficiente" porque el protocolo no contiene códigos.
 *
 * Este detector identifica ese intent con heurística léxica (sin LLM, < 1ms) y
 * extrae los conceptos clínicos involucrados resolviéndolos contra el diccionario
 * validado (ver ADR-004). El resultado alimenta el camino híbrido del chat:
 * citar lo que dice el protocolo + proponer el código como sugerencia externa.
 */

const TERMINOLOGY_KEYWORDS = [
  'snomed',
  'snomed-ct',
  'snomedct',
  'loinc',
  'cie-10',
  'cie10',
  'icd-10',
  'icd10',
  'icd',
  'terminologia',
  'terminología',
  'codificar',
  'codificacion',
  'codificación',
  'codigo',
  'código',
  'codigos',
  'códigos',
  'asociar',
  'asocia',
  'mapear',
  'mapea',
  'mapeo',
  'concepto clinico',
  'concepto clínico',
] as const

export type TerminologyIntent = {
  isTerminologyQuery: boolean
  /** Conceptos clínicos detectados con su código sugerido (puede ser []). */
  suggestions: TerminologySuggestion[]
}

/**
 * Detecta si la pregunta busca un código de terminología clínica y, de ser así,
 * resuelve los conceptos contra el diccionario.
 *
 * No lanza. Retorna `isTerminologyQuery: false` cuando no hay señal de intent.
 */
export function detectTerminologyIntent(question: string): TerminologyIntent {
  const normalized = question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const isTerminologyQuery = TERMINOLOGY_KEYWORDS.some((kw) =>
    normalized.includes(
      kw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''),
    ),
  )

  if (!isTerminologyQuery) {
    return { isTerminologyQuery: false, suggestions: [] }
  }

  // El diccionario hace longest-match-first sobre el texto original (respeta
  // mayúsculas para abreviaturas cortas como "Hb", "ALT").
  const suggestions = lookupTerminology(question)

  return { isTerminologyQuery: true, suggestions }
}
