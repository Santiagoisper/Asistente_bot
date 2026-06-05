import type { RetrievedChunk } from './retriever'
import type { AnswerConfidence } from '@ichtys/db'

/**
 * guardrails.ts — lógica de confianza y fallback.
 *
 * Principio (PRD §5, CLAUDE.md 6): una respuesta incorrecta con apariencia de
 * certeza es peor que ninguna respuesta. El fallback es una feature.
 */

/** Mínimo de chunks por encima del umbral para intentar responder. */
export const MIN_CHUNKS_FOR_ANSWER = 1

export const INSUFFICIENT_EVIDENCE_MESSAGE =
  "I don't have sufficient evidence in the uploaded documents to answer this question. " +
  'Please consult the study team or review the source documents directly.'

export interface EvidenceAssessment {
  hasEvidence: boolean
  /** Confianza preliminar derivada de la cantidad/calidad de la evidencia. */
  baselineConfidence: AnswerConfidence
}

/**
 * Decide si hay evidencia suficiente para invocar al LLM y con qué confianza
 * de base, en función de los chunks recuperados (ya filtrados por umbral).
 */
export function assessEvidence(retrieved: RetrievedChunk[]): EvidenceAssessment {
  if (retrieved.length < MIN_CHUNKS_FOR_ANSWER) {
    return { hasEvidence: false, baselineConfidence: 'insufficient_evidence' }
  }

  const top = retrieved[0]?.similarity ?? 0

  let baselineConfidence: AnswerConfidence = 'low'
  if (top >= 0.85 && retrieved.length >= 3) baselineConfidence = 'high'
  else if (top >= 0.8) baselineConfidence = 'medium'

  return { hasEvidence: true, baselineConfidence }
}

/**
 * Respuesta de fallback estándar cuando no hay evidencia.
 */
export function insufficientEvidenceAnswer(): {
  answer: string
  confidence: AnswerConfidence
} {
  return { answer: INSUFFICIENT_EVIDENCE_MESSAGE, confidence: 'insufficient_evidence' }
}
