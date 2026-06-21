import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CaseResultSchema,
  EvalSuiteResultSchema,
  FormalEvalCaseSchema,
  FormalEvalDatasetSchema,
} from '../types'

// ---------------------------------------------------------------------------
// Dataset file validation
// ---------------------------------------------------------------------------

const DATASET_PATH = join(import.meta.dirname, '../dataset/mock-metabolic-eval-cases.json')

function loadRawDataset(): unknown {
  return JSON.parse(readFileSync(DATASET_PATH, 'utf-8')) as unknown
}

describe('mock-metabolic-eval-cases.json', () => {
  it('parses as a valid FormalEvalDataset', () => {
    const raw = loadRawDataset()
    const result = FormalEvalDatasetSchema.safeParse(raw)
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true)
  })

  it('has the correct number of cases declared in _meta', () => {
    const raw = loadRawDataset() as { _meta: { totalCases: number }; cases: unknown[] }
    expect(raw.cases.length).toBe(raw._meta.totalCases)
  })

  it('has exactly 2 adversarial cases (SM-011, SM-012)', () => {
    const raw = loadRawDataset() as { cases: Array<{ id: string; category: string }> }
    const adversarial = raw.cases.filter((c) => c.category === 'adversarial_no_evidence')
    expect(adversarial.length).toBe(2)
    expect(adversarial.map((c) => c.id).sort()).toEqual(['SM-011', 'SM-012'])
  })

  it('adversarial cases have shouldBeInsufficientEvidence=true', () => {
    const raw = loadRawDataset() as {
      cases: Array<{ category: string; shouldBeInsufficientEvidence: boolean }>
    }
    const adversarial = raw.cases.filter((c) => c.category === 'adversarial_no_evidence')
    expect(adversarial.every((c) => c.shouldBeInsufficientEvidence)).toBe(true)
  })

  it('grounded cases have shouldBeInsufficientEvidence=false', () => {
    const raw = loadRawDataset() as {
      cases: Array<{ category: string; shouldBeInsufficientEvidence: boolean; expectedAnswerType: string }>
    }
    const grounded = raw.cases.filter((c) => c.expectedAnswerType === 'grounded')
    expect(grounded.every((c) => !c.shouldBeInsufficientEvidence)).toBe(true)
  })

  it('all case IDs are unique', () => {
    const raw = loadRawDataset() as { cases: Array<{ id: string }> }
    const ids = raw.cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('grounded cases have non-empty expectedEvidenceKeywords', () => {
    const raw = loadRawDataset() as {
      cases: Array<{ expectedAnswerType: string; expectedEvidenceKeywords: string[] }>
    }
    const grounded = raw.cases.filter((c) => c.expectedAnswerType === 'grounded')
    expect(grounded.every((c) => c.expectedEvidenceKeywords.length > 0)).toBe(true)
  })

  it('each case validates individually against FormalEvalCaseSchema', () => {
    const raw = loadRawDataset() as { cases: unknown[] }
    for (const c of raw.cases) {
      const result = FormalEvalCaseSchema.safeParse(c)
      expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// CaseResultSchema validation
// ---------------------------------------------------------------------------

describe('CaseResultSchema', () => {
  it('accepts a valid PASS case result', () => {
    const result = CaseResultSchema.safeParse({
      caseId: 'SM-001',
      question: 'test question',
      expectedConfidence: 'any',
      actualConfidence: 'high',
      answerSnippet: 'HbA1c must be between 7.0 and 10.0.',
      evidenceCount: 1,
      matchedExpectedKeywords: true,
      forbiddenKeywordsFound: false,
      matchedExpectedSection: true,
      insufficientEvidenceCorrect: true,
      status: 'PASS',
      failureType: null,
      failureReason: null,
      durationMs: 500,
    })
    expect(result.success).toBe(true)
  })

  it('accepts matchedExpectedSection as null', () => {
    const result = CaseResultSchema.safeParse({
      caseId: 'SM-011',
      question: 'adversarial',
      expectedConfidence: 'insufficient_evidence',
      actualConfidence: 'insufficient_evidence',
      answerSnippet: '',
      evidenceCount: 0,
      matchedExpectedKeywords: true,
      forbiddenKeywordsFound: false,
      matchedExpectedSection: null,
      insufficientEvidenceCorrect: true,
      status: 'PASS',
      failureType: null,
      failureReason: null,
      durationMs: 100,
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative durationMs', () => {
    const result = CaseResultSchema.safeParse({
      caseId: 'SM-001',
      question: 'test',
      expectedConfidence: 'any',
      actualConfidence: 'high',
      answerSnippet: '',
      evidenceCount: 0,
      matchedExpectedKeywords: false,
      forbiddenKeywordsFound: false,
      matchedExpectedSection: null,
      insufficientEvidenceCorrect: true,
      status: 'PASS',
      failureType: null,
      failureReason: null,
      durationMs: -1,
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// EvalSuiteResultSchema validation
// ---------------------------------------------------------------------------

describe('EvalSuiteResultSchema', () => {
  it('rejects passRate > 1', () => {
    const result = EvalSuiteResultSchema.safeParse({
      runId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      studyId: 'study-1',
      baseUrl: 'http://localhost:3000',
      totalCases: 10,
      passCount: 10,
      failCount: 0,
      errorCount: 0,
      skipCount: 0,
      passRate: 1.5,
      insufficientEvidenceAccuracy: 1,
      keywordMatchRate: 1,
      sectionMatchRate: 1,
      cases: [],
    })
    expect(result.success).toBe(false)
  })
})
