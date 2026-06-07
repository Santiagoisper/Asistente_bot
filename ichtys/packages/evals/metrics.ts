import type { AnswerResult } from '@ichtys/rag'
import type { CaseResult, EvalSuiteResult, FormalEvalCase } from './types'
import { aggregateSuiteResults, scoreCase } from './scoring'

// ---------------------------------------------------------------------------
// Re-exports for external consumers
// ---------------------------------------------------------------------------

export type { EvalCategory, Confidence, FailureType, FormalEvalCase, FormalEvalDataset, CaseResult, EvalSuiteResult } from './types'
export { FormalEvalCaseSchema, FormalEvalDatasetSchema, CaseResultSchema, EvalSuiteResultSchema } from './types'

// ---------------------------------------------------------------------------
// Aggregate metrics shape (kept for backwards compatibility with runner.ts)
// ---------------------------------------------------------------------------

export interface AggregateMetrics {
  total: number
  groundedAnswerRate: number
  citationCorrectnessRate: number
  citedAnswerRate: number
  crossTenantLeakageRate: number
  crossStudyLeakageRate: number
}

// ---------------------------------------------------------------------------
// Per-case evaluation (Phase 10B — wraps scoring.ts)
// ---------------------------------------------------------------------------

export interface CaseEvaluation {
  caseId: string
  hasCitations: boolean
  groundednessScore: number // 0..1
  citationCorrectness: number // 0..1
  fallbackCorrect: boolean
}

/**
 * Evaluates a single answer against its FormalEvalCase.
 * Returns a CaseResult for structured reporting.
 */
export function evaluateFormalCase(
  testCase: FormalEvalCase,
  result: AnswerResult,
  durationMs: number,
): CaseResult {
  return scoreCase(testCase, result, durationMs)
}

/**
 * Thin wrapper that produces the legacy CaseEvaluation shape.
 * Used by tests and code that pre-dates Phase 10B.
 */
export function evaluateCase(testCase: FormalEvalCase, result: AnswerResult): CaseEvaluation {
  const isFallback = result.confidence === 'insufficient_evidence'
  const fallbackCorrect = testCase.shouldBeInsufficientEvidence === isFallback
  const hasCitations = result.evidences.length > 0

  const expectedIds = new Set<string>()
  const citedExpected = result.evidences.filter((e) => expectedIds.has(e.documentId)).length
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
 * Aggregates CaseEvaluation[] into legacy AggregateMetrics.
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
    // Leakage is measured with dedicated adversarial cases in the runner.
    crossTenantLeakageRate: 0,
    crossStudyLeakageRate: 0,
  }
}

/**
 * Aggregates CaseResult[] into an EvalSuiteResult.
 */
export function aggregateResults(
  cases: CaseResult[],
  runId: string,
  studyId: string,
  baseUrl: string,
  timestamp: string,
): EvalSuiteResult {
  return {
    ...aggregateSuiteResults(cases, runId, studyId, baseUrl),
    timestamp,
  }
}
