import { z } from 'zod'

// ---------------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------------

export const EvalCategorySchema = z.enum([
  'eligibility',
  'visit_schedule',
  'lab_handling',
  'pharmacy',
  'safety',
  'procedure',
  'adversarial_no_evidence',
])

export type EvalCategory = z.infer<typeof EvalCategorySchema>

export const ConfidenceSchema = z.enum([
  'high',
  'medium',
  'low',
  'insufficient_evidence',
])

export type Confidence = z.infer<typeof ConfidenceSchema>

export const FailureTypeSchema = z.enum([
  'retrieval_miss',         // expected evidence but got none
  'wrong_section',          // got evidence but sectionTitle doesn't match expected
  'answer_unsupported',     // expected keywords absent from answer and excerpts
  'forbidden_keywords_found', // answer contains hallucination markers
  'false_insufficient_evidence', // expected grounded answer but got insufficient_evidence
  'missed_insufficient_evidence', // expected insufficient_evidence but got confident answer
  'runtime_error',          // HTTP call or parse failure
  'test_setup_error',       // missing config, invalid case definition
])

export type FailureType = z.infer<typeof FailureTypeSchema>

// ---------------------------------------------------------------------------
// Formal eval case (input)
// ---------------------------------------------------------------------------

export const FormalEvalCaseSchema = z.object({
  id: z.string().min(1),
  category: EvalCategorySchema,
  question: z.string().min(1),
  /** What confidence level we expect. "any" accepts any non-insufficient_evidence value. */
  expectedConfidence: ConfidenceSchema.or(z.literal('any')),
  expectedAnswerType: z.enum(['grounded', 'insufficient_evidence']),
  expectedDocumentType: z.string().nullable(),
  expectedDocumentName: z.string().nullable(),
  expectedSectionTitle: z.string().nullable(),
  expectedPageStart: z.number().int().positive().nullable(),
  expectedPageEnd: z.number().int().positive().nullable(),
  /**
   * Keywords that should appear somewhere in the answer or evidence excerpts.
   * Matching is case-insensitive and checks substrings. Empty = no keyword check.
   * This is a proxy metric — see docs/decisions/formal-eval-suite.md.
   */
  expectedEvidenceKeywords: z.array(z.string()),
  /**
   * Keywords whose presence in the answer indicates a likely hallucination.
   * Matching is case-insensitive substring. Empty = no forbidden-keyword check.
   */
  forbiddenAnswerKeywords: z.array(z.string()),
  /** Whether the answer engine should return at least one evidence chunk. */
  shouldHaveEvidence: z.boolean(),
  /** Whether confidence should be 'insufficient_evidence'. */
  shouldBeInsufficientEvidence: z.boolean(),
  notes: z.string().optional(),
})

export type FormalEvalCase = z.infer<typeof FormalEvalCaseSchema>

export const FormalEvalDatasetSchema = z.object({
  _meta: z.object({
    version: z.string(),
    phase: z.string(),
    studyMock: z.string(),
    totalCases: z.number().int().positive(),
    note: z.string().optional(),
  }),
  cases: z.array(FormalEvalCaseSchema),
})

export type FormalEvalDataset = z.infer<typeof FormalEvalDatasetSchema>

// ---------------------------------------------------------------------------
// Per-case result (output)
// ---------------------------------------------------------------------------

export const CaseResultSchema = z.object({
  caseId: z.string(),
  question: z.string(),
  expectedConfidence: z.string(),
  actualConfidence: z.string(),
  /** Answer text truncated to 300 characters. Never the full response. */
  answerSnippet: z.string(),
  evidenceCount: z.number().int().nonnegative(),
  /** True if at least one expected keyword was found in answer or excerpts. */
  matchedExpectedKeywords: z.boolean(),
  /** True if any forbidden keyword was found in the answer. */
  forbiddenKeywordsFound: z.boolean(),
  /**
   * True/false when expectedSectionTitle is set; null when not applicable.
   * Uses a partial case-insensitive substring match against evidence.sectionTitle.
   * Note: does NOT verify the source document — only the section title.
   */
  matchedExpectedSection: z.boolean().nullable(),
  /** True when confidence matches shouldBeInsufficientEvidence. */
  insufficientEvidenceCorrect: z.boolean(),
  status: z.enum(['PASS', 'FAIL', 'SKIP', 'ERROR']),
  failureType: FailureTypeSchema.nullable(),
  failureReason: z.string().nullable(),
  durationMs: z.number().nonnegative(),
})

export type CaseResult = z.infer<typeof CaseResultSchema>

// ---------------------------------------------------------------------------
// Aggregate suite result
// ---------------------------------------------------------------------------

export const EvalSuiteResultSchema = z.object({
  runId: z.string().uuid(),
  timestamp: z.string().datetime(),
  studyId: z.string(),
  baseUrl: z.string(),
  totalCases: z.number().int().nonnegative(),
  passCount: z.number().int().nonnegative(),
  failCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  skipCount: z.number().int().nonnegative(),
  /** passCount / totalCases */
  passRate: z.number().min(0).max(1),
  /** fraction of adversarial cases that correctly returned insufficient_evidence */
  insufficientEvidenceAccuracy: z.number().min(0).max(1),
  /** fraction of grounded cases that matched at least one expected keyword */
  keywordMatchRate: z.number().min(0).max(1),
  /** fraction of cases with expectedSectionTitle that matched */
  sectionMatchRate: z.number().min(0).max(1),
  cases: z.array(CaseResultSchema),
})

export type EvalSuiteResult = z.infer<typeof EvalSuiteResultSchema>
