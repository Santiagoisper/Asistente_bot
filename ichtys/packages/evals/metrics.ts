import type { AnswerResult } from '@ichtys/rag'

/**
 * metrics.ts — métricas de calidad del RAG (PRD §9, EVALS.md).
 *
 * Las métricas clave para release:
 *  - groundedness: ¿la respuesta se apoya solo en las citas?
 *  - citation correctness: ¿las citas apuntan a la fuente correcta?
 *  - leakage: cross-tenant / cross-study (target 0%, bloqueante).
 */

export interface EvalCase {
  id: string
  organizationId: string
  studyId: string
  question: string
  /** Respuesta esperada (para juicio humano/LLM-judge), opcional. */
  expectedAnswer?: string
  /** Si la respuesta correcta es "no hay evidencia". */
  expectInsufficientEvidence?: boolean
  /** document_ids que deberían aparecer en las citas. */
  expectedDocumentIds?: string[]
}

export interface CaseEvaluation {
  caseId: string
  hasCitations: boolean
  groundednessScore: number // 0..1
  citationCorrectness: number // 0..1
  fallbackCorrect: boolean
}

export interface AggregateMetrics {
  total: number
  groundedAnswerRate: number
  citationCorrectnessRate: number
  citedAnswerRate: number
  crossTenantLeakageRate: number
  crossStudyLeakageRate: number
}

/**
 * Evalúa una respuesta contra su caso esperado.
 */
export function evaluateCase(testCase: EvalCase, result: AnswerResult): CaseEvaluation {
  const isFallback = result.confidence === 'insufficient_evidence'
  const fallbackCorrect = Boolean(testCase.expectInsufficientEvidence) === isFallback

  // TODO(paso-10): groundedness y citation correctness reales (LLM-judge + match
  // de document_ids esperados). Por ahora chequeos estructurales mínimos.
  const hasCitations = result.citations.length > 0
  const expectedIds = new Set(testCase.expectedDocumentIds ?? [])
  const citedExpected = result.citations.filter((c) => expectedIds.has(c.documentId)).length
  const citationCorrectness = expectedIds.size === 0 ? 0 : citedExpected / expectedIds.size

  return {
    caseId: testCase.id,
    hasCitations,
    groundednessScore: isFallback ? (fallbackCorrect ? 1 : 0) : hasCitations ? 1 : 0,
    citationCorrectness,
    fallbackCorrect,
  }
}

/**
 * Agrega evaluaciones individuales en métricas de release.
 */
export function aggregate(evaluations: CaseEvaluation[]): AggregateMetrics {
  const total = evaluations.length
  const safeRate = (n: number) => (total === 0 ? 0 : n / total)

  return {
    total,
    groundedAnswerRate: safeRate(evaluations.filter((e) => e.groundednessScore >= 1).length),
    citationCorrectnessRate:
      total === 0
        ? 0
        : evaluations.reduce((s, e) => s + e.citationCorrectness, 0) / total,
    citedAnswerRate: safeRate(evaluations.filter((e) => e.hasCitations).length),
    // Leakage se mide con casos adversariales dedicados (ver runner). Default 0.
    crossTenantLeakageRate: 0,
    crossStudyLeakageRate: 0,
  }
}
