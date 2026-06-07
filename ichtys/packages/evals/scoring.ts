import type { AnswerResult } from '@ichtys/rag'
import type { CaseResult, EvalSuiteResult, FailureType, FormalEvalCase } from './types'

// ---------------------------------------------------------------------------
// Keyword matching
// ---------------------------------------------------------------------------

/**
 * Returns true if the haystack contains any of the needles (case-insensitive substring).
 * Empty needle list → always returns true (no constraint to satisfy).
 */
export function containsAny(haystack: string, needles: string[]): boolean {
  if (needles.length === 0) return true
  const lower = haystack.toLowerCase()
  return needles.some((n) => lower.includes(n.toLowerCase()))
}

/**
 * Returns true if the haystack contains NONE of the needles (case-insensitive substring).
 * Empty needle list → always returns true (nothing forbidden).
 */
export function containsNone(haystack: string, needles: string[]): boolean {
  if (needles.length === 0) return true
  const lower = haystack.toLowerCase()
  return !needles.some((n) => lower.includes(n.toLowerCase()))
}

// ---------------------------------------------------------------------------
// Individual scoring
// ---------------------------------------------------------------------------

/**
 * Checks whether at least one evidence has a sectionTitle that contains the
 * expected section (case-insensitive partial match).
 * Returns null when expectedSectionTitle is null (not applicable).
 */
export function scoreSection(
  evidences: AnswerResult['evidences'],
  expectedSectionTitle: string | null,
): boolean | null {
  if (!expectedSectionTitle) return null
  const target = expectedSectionTitle.toLowerCase()
  return evidences.some(
    (e) => e.sectionTitle !== null && e.sectionTitle !== undefined && e.sectionTitle.toLowerCase().includes(target),
  )
}

/**
 * Checks expected keywords against both the answer text and evidence excerpts.
 * Empty keyword list → trivially true.
 * Uses case-insensitive substring matching.
 *
 * Note: keyword matching is a proxy indicator, not a correctness oracle.
 * Language variation (e.g. locale decimal separators) may cause false negatives.
 */
export function scoreKeywords(
  answer: string,
  evidences: AnswerResult['evidences'],
  expectedKeywords: string[],
): boolean {
  if (expectedKeywords.length === 0) return true
  const corpus = [answer, ...evidences.map((e) => e.excerpt)].join(' ')
  return containsAny(corpus, expectedKeywords)
}

/**
 * Checks that no forbidden keyword appears in the answer text.
 */
export function scoreForbiddenKeywords(answer: string, forbidden: string[]): boolean {
  return containsNone(answer, forbidden)
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export function classifyFailure(
  evalCase: FormalEvalCase,
  result: AnswerResult,
  matchedKeywords: boolean,
  matchedSection: boolean | null,
  noForbiddenKeywords: boolean,
): FailureType | null {
  const isInsufficient = result.confidence === 'insufficient_evidence'

  if (evalCase.shouldBeInsufficientEvidence && !isInsufficient) {
    return 'missed_insufficient_evidence'
  }
  if (!evalCase.shouldBeInsufficientEvidence && isInsufficient) {
    return 'false_insufficient_evidence'
  }
  if (evalCase.shouldHaveEvidence && result.evidences.length === 0) {
    return 'retrieval_miss'
  }
  if (!noForbiddenKeywords) {
    return 'forbidden_keywords_found'
  }
  if (evalCase.expectedEvidenceKeywords.length > 0 && !matchedKeywords) {
    return 'answer_unsupported'
  }
  if (matchedSection === false) {
    return 'wrong_section'
  }
  return null
}

// ---------------------------------------------------------------------------
// Score one case
// ---------------------------------------------------------------------------

export function scoreCase(
  evalCase: FormalEvalCase,
  result: AnswerResult,
  durationMs: number,
): CaseResult {
  const isInsufficient = result.confidence === 'insufficient_evidence'
  const insufficientEvidenceCorrect =
    isInsufficient === evalCase.shouldBeInsufficientEvidence

  const matchedKeywords = scoreKeywords(
    result.answer,
    result.evidences,
    evalCase.expectedEvidenceKeywords,
  )
  const matchedSection = scoreSection(result.evidences, evalCase.expectedSectionTitle)
  const noForbiddenKeywords = scoreForbiddenKeywords(
    result.answer,
    evalCase.forbiddenAnswerKeywords,
  )

  const failureType = classifyFailure(evalCase, result, matchedKeywords, matchedSection, noForbiddenKeywords)

  const passed =
    insufficientEvidenceCorrect &&
    noForbiddenKeywords &&
    matchedKeywords &&
    matchedSection !== false &&
    !(evalCase.shouldHaveEvidence && result.evidences.length === 0)

  return {
    caseId: evalCase.id,
    question: evalCase.question,
    expectedConfidence: evalCase.expectedConfidence,
    actualConfidence: result.confidence,
    answerSnippet: result.answer.slice(0, 300),
    evidenceCount: result.evidences.length,
    matchedExpectedKeywords: matchedKeywords,
    forbiddenKeywordsFound: !noForbiddenKeywords,
    matchedExpectedSection: matchedSection,
    insufficientEvidenceCorrect,
    status: passed ? 'PASS' : 'FAIL',
    failureType: passed ? null : (failureType ?? 'answer_unsupported'),
    failureReason: passed ? null : buildFailureReason(evalCase, result, failureType),
    durationMs,
  }
}

function buildFailureReason(
  evalCase: FormalEvalCase,
  result: AnswerResult,
  failureType: FailureType | null,
): string {
  switch (failureType) {
    case 'missed_insufficient_evidence':
      return `Expected insufficient_evidence but got '${result.confidence}'`
    case 'false_insufficient_evidence':
      return `Expected grounded answer but got insufficient_evidence`
    case 'retrieval_miss':
      return `Expected evidence but got 0 chunks (shouldHaveEvidence=true)`
    case 'forbidden_keywords_found':
      return `Answer contains forbidden keyword(s): ${evalCase.forbiddenAnswerKeywords.filter((k) => result.answer.toLowerCase().includes(k.toLowerCase())).join(', ')}`
    case 'answer_unsupported':
      return `None of the expected keywords found in answer or excerpts: [${evalCase.expectedEvidenceKeywords.join(', ')}]`
    case 'wrong_section':
      return `Expected sectionTitle containing '${evalCase.expectedSectionTitle}' but no matching evidence found`
    default:
      return `Unexpected failure`
  }
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export function aggregateSuiteResults(
  cases: CaseResult[],
  runId: string,
  studyId: string,
  baseUrl: string,
): Omit<EvalSuiteResult, 'timestamp'> {
  const total = cases.length
  const passCount = cases.filter((c) => c.status === 'PASS').length
  const failCount = cases.filter((c) => c.status === 'FAIL').length
  const errorCount = cases.filter((c) => c.status === 'ERROR').length
  const skipCount = cases.filter((c) => c.status === 'SKIP').length

  const adversarialCases = cases.filter(
    (c) => c.expectedConfidence === 'insufficient_evidence',
  )
  const insufficientEvidenceAccuracy =
    adversarialCases.length === 0
      ? 1
      : adversarialCases.filter((c) => c.insufficientEvidenceCorrect).length /
        adversarialCases.length

  const groundedCases = cases.filter(
    (c) => c.expectedConfidence !== 'insufficient_evidence' && c.status !== 'ERROR',
  )
  const keywordMatchRate =
    groundedCases.length === 0
      ? 1
      : groundedCases.filter((c) => c.matchedExpectedKeywords).length /
        groundedCases.length

  const sectionCases = cases.filter((c) => c.matchedExpectedSection !== null)
  const sectionMatchRate =
    sectionCases.length === 0
      ? 1
      : sectionCases.filter((c) => c.matchedExpectedSection === true).length /
        sectionCases.length

  return {
    runId,
    studyId,
    baseUrl,
    totalCases: total,
    passCount,
    failCount,
    errorCount,
    skipCount,
    passRate: total === 0 ? 0 : passCount / total,
    insufficientEvidenceAccuracy,
    keywordMatchRate,
    sectionMatchRate,
    cases,
  }
}
