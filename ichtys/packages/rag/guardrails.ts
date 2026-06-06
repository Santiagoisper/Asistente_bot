import type { RetrievedChunk } from './retriever'
import type { AnswerConfidence } from '@ichtys/db'

/**
 * guardrails.ts — lógica de confianza, umbral, fallback e i18n.
 *
 * Principio (PRD §5, CLAUDE.md 6): una respuesta incorrecta con apariencia de
 * certeza es peor que ninguna respuesta. El fallback es una feature.
 */

/** Mínimo de chunks por encima del umbral para intentar responder. */
export const MIN_CHUNKS_FOR_ANSWER = 1

/**
 * Umbral mínimo de similitud coseno para considerar un chunk como evidencia.
 * Alineado con ARCHITECTURE.md: similarity threshold >= 0.75.
 */
export const MIN_SIMILARITY_THRESHOLD = 0.75

/** Idiomas soportados para mensajes de fallback. Default: 'en'. */
export type SupportedLanguage = 'en' | 'es'

export const INSUFFICIENT_EVIDENCE_MESSAGES: Record<SupportedLanguage, string> = {
  en: 'I do not have sufficient information in the available documents to answer this question.',
  es: 'No tengo información suficiente en los documentos disponibles para responder esta pregunta.',
}

/** Conservado por compatibilidad con código existente. */
export const INSUFFICIENT_EVIDENCE_MESSAGE = INSUFFICIENT_EVIDENCE_MESSAGES.en

// Indicadores morfológicos del español. La presencia de cualquiera de estos
// en la pregunta es señal suficiente sin necesidad de modelos externos.
const SPANISH_CHAR_PATTERN = /[¿¡ñÑáéíóúÁÉÍÓÚ]/
const SPANISH_WORD_PATTERN =
  /\b(qué|cuál|cómo|está|estás|para|tiene|tienen|son|las|los|del|una|por|con|que|es|se|en|no|hay|más|si|su|te|le|la|un|al|qué|dónde|cuándo|quién|quiénes)\b/i

/**
 * Detecta el idioma de la pregunta mediante heurística léxica ligera.
 * Sin dependencias externas; sin llamadas al LLM.
 * Default: 'en' cuando no hay señal clara de español.
 */
export function detectQuestionLanguage(question: string): SupportedLanguage {
  if (SPANISH_CHAR_PATTERN.test(question)) return 'es'
  if (SPANISH_WORD_PATTERN.test(question)) return 'es'
  return 'en'
}

/**
 * Devuelve el mensaje de insufficient_evidence en el idioma de la pregunta.
 * No llama al LLM.
 */
export function getInsufficientEvidenceMessage(question: string): string {
  return INSUFFICIENT_EVIDENCE_MESSAGES[detectQuestionLanguage(question)]
}

export interface EvidenceAssessment {
  hasEvidence: boolean
  /** Confianza preliminar derivada de la cantidad/calidad de la evidencia. */
  baselineConfidence: AnswerConfidence
}

/**
 * Filtra chunks por encima del umbral de similitud mínimo.
 * Llamar antes de assessEvidence para garantizar que solo se evalúan
 * chunks con score suficiente.
 */
export function filterByThreshold(
  retrieved: readonly RetrievedChunk[],
  threshold = MIN_SIMILARITY_THRESHOLD,
): RetrievedChunk[] {
  return retrieved.filter((c) => c.similarityScore >= threshold)
}

/**
 * Decide si hay evidencia suficiente para invocar al LLM y con qué confianza
 * de base, en función de los chunks recuperados (ya filtrados por umbral).
 */
export function assessEvidence(retrieved: RetrievedChunk[]): EvidenceAssessment {
  if (retrieved.length < MIN_CHUNKS_FOR_ANSWER) {
    return { hasEvidence: false, baselineConfidence: 'insufficient_evidence' }
  }

  const top = retrieved[0]?.similarityScore ?? 0

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
