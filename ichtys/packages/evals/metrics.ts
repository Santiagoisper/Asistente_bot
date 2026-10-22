import type { AnswerResult } from '@ichtys/rag'
import type { CaseResult, EvalSuiteResult, FormalEvalCase } from './types'
import { aggregateSuiteResults, scoreCase } from './scoring'

// ---------------------------------------------------------------------------
// Re-exports for external consumers
// ---------------------------------------------------------------------------

export type { EvalCategory, Confidence, FailureType, FormalEvalCase, FormalEvalDataset, CaseResult, EvalSuiteResult } from './types'
export { FormalEvalCaseSchema, FormalEvalDatasetSchema, CaseResultSchema, EvalSuiteResultSchema } from './types'

// ---------------------------------------------------------------------------
// Per-case evaluation (Phase 10B — wraps scoring.ts)
// ---------------------------------------------------------------------------

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
