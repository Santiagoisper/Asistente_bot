import { describe, expect, it } from 'vitest'
import type { AnswerResult } from '@ichtys/rag'
import {
  classifyFailure,
  containsAny,
  containsNone,
  scoreCase,
  scoreForbiddenKeywords,
  scoreKeywords,
  scoreSection,
} from '../scoring'
import type { FormalEvalCase } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides: Partial<AnswerResult['evidences'][number]> = {}): AnswerResult['evidences'][number] {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    pageStart: null,
    pageEnd: null,
    sectionTitle: null,
    excerpt: '',
    ...overrides,
  }
}

function makeAnswer(overrides: Partial<AnswerResult> = {}): AnswerResult {
  return {
    answer: 'The protocol requires HbA1c between 7.0% and 10.0%.',
    confidence: 'high',
    evidences: [],
    ...overrides,
  }
}

function makeCase(overrides: Partial<FormalEvalCase> = {}): FormalEvalCase {
  return {
    id: 'SM-001',
    category: 'eligibility',
    question: 'Test question',
    expectedConfidence: 'any',
    expectedAnswerType: 'grounded',
    expectedDocumentType: 'protocol',
    expectedDocumentName: 'Protocol.pdf',
    expectedSectionTitle: '3.1 Inclusion Criteria',
    expectedPageStart: null,
    expectedPageEnd: null,
    expectedEvidenceKeywords: ['HbA1c', '7.0', '10.0'],
    forbiddenAnswerKeywords: [],
    shouldHaveEvidence: true,
    shouldBeInsufficientEvidence: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// containsAny
// ---------------------------------------------------------------------------

describe('containsAny', () => {
  it('returns true when a needle is found', () => {
    expect(containsAny('The HbA1c range is 7.0 to 10.0', ['HbA1c'])).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(containsAny('HBAC1 test', ['hba1c'])).toBe(false)
    expect(containsAny('HbA1c test', ['hba1c'])).toBe(true)
  })

  it('returns false when no needle matches', () => {
    expect(containsAny('no match here', ['GLP-1', 'SGLT2'])).toBe(false)
  })

  it('returns true when needles list is empty', () => {
    expect(containsAny('anything', [])).toBe(true)
  })

  it('matches first of multiple needles', () => {
    expect(containsAny('section 3.2', ['3.1', '3.2', '3.3'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// containsNone
// ---------------------------------------------------------------------------

describe('containsNone', () => {
  it('returns false when a forbidden word is present', () => {
    expect(containsNone('this is hallucinated', ['hallucinated'])).toBe(false)
  })

  it('returns true when no forbidden word is present', () => {
    expect(containsNone('clean answer', ['hallucinated', 'invented'])).toBe(true)
  })

  it('returns true when needle list is empty', () => {
    expect(containsNone('anything', [])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// scoreSection
// ---------------------------------------------------------------------------

describe('scoreSection', () => {
  it('returns null when expectedSectionTitle is null', () => {
    expect(scoreSection([], null)).toBeNull()
  })

  it('returns false when no evidences', () => {
    expect(scoreSection([], '3.1 Inclusion Criteria')).toBe(false)
  })

  it('returns true on case-insensitive partial match', () => {
    const evidence = makeEvidence({ sectionTitle: '3.1 Inclusion Criteria' })
    expect(scoreSection([evidence], '3.1')).toBe(true)
    expect(scoreSection([evidence], '3.1 inclusion criteria')).toBe(true)
  })

  it('returns false when sectionTitle does not match', () => {
    const evidence = makeEvidence({ sectionTitle: '3.2 Exclusion Criteria' })
    expect(scoreSection([evidence], '3.1 Inclusion Criteria')).toBe(false)
  })

  it('returns false when evidence has null sectionTitle', () => {
    const evidence = makeEvidence({ sectionTitle: null })
    expect(scoreSection([evidence], '3.1')).toBe(false)
  })

  it('returns true if at least one of multiple evidences matches', () => {
    const evidences = [
      makeEvidence({ sectionTitle: '3.2 Exclusion Criteria' }),
      makeEvidence({ sectionTitle: '3.1 Inclusion Criteria' }),
    ]
    expect(scoreSection(evidences, '3.1')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// scoreKeywords
// ---------------------------------------------------------------------------

describe('scoreKeywords', () => {
  it('returns true when keyword found in answer', () => {
    expect(scoreKeywords('HbA1c must be between 7.0 and 10.0', [], ['HbA1c'])).toBe(true)
  })

  it('returns true when keyword found in excerpt', () => {
    const evidence = makeEvidence({ excerpt: 'HbA1c range: 7.0% to 10.0%' })
    expect(scoreKeywords('no keywords here', [evidence], ['HbA1c'])).toBe(true)
  })

  it('returns false when keyword is absent everywhere', () => {
    expect(scoreKeywords('no relevant content', [], ['HbA1c'])).toBe(false)
  })

  it('returns true when keyword list is empty', () => {
    expect(scoreKeywords('anything', [], [])).toBe(true)
  })

  it('matches partial substring', () => {
    expect(scoreKeywords('centrifugation procedure', [], ['centrifug'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// scoreForbiddenKeywords
// ---------------------------------------------------------------------------

describe('scoreForbiddenKeywords', () => {
  it('returns false when forbidden keyword found', () => {
    expect(scoreForbiddenKeywords('The visit 99 procedure is X', ['visit 99'])).toBe(false)
  })

  it('returns true when no forbidden keywords', () => {
    expect(scoreForbiddenKeywords('clean answer', ['hallucination'])).toBe(true)
  })

  it('returns true when forbidden list is empty', () => {
    expect(scoreForbiddenKeywords('anything', [])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// classifyFailure
// ---------------------------------------------------------------------------

describe('classifyFailure', () => {
  it('classifies missed_insufficient_evidence when expected fallback but got high confidence', () => {
    const evalCase = makeCase({ shouldBeInsufficientEvidence: true })
    const result = makeAnswer({ confidence: 'high', evidences: [makeEvidence()] })
    expect(classifyFailure(evalCase, result, true, null, true)).toBe('missed_insufficient_evidence')
  })

  it('classifies false_insufficient_evidence when expected grounded but got fallback', () => {
    const evalCase = makeCase({ shouldBeInsufficientEvidence: false })
    const result = makeAnswer({ confidence: 'insufficient_evidence', evidences: [] })
    expect(classifyFailure(evalCase, result, false, null, true)).toBe('false_insufficient_evidence')
  })

  it('classifies retrieval_miss when shouldHaveEvidence but got zero chunks', () => {
    const evalCase = makeCase({ shouldHaveEvidence: true })
    const result = makeAnswer({ confidence: 'medium', evidences: [] })
    expect(classifyFailure(evalCase, result, false, null, true)).toBe('retrieval_miss')
  })

  it('classifies forbidden_keywords_found', () => {
    const evalCase = makeCase({ shouldHaveEvidence: false })
    const result = makeAnswer({ confidence: 'high', evidences: [makeEvidence()] })
    expect(classifyFailure(evalCase, result, true, null, false)).toBe('forbidden_keywords_found')
  })

  it('classifies answer_unsupported when expected keywords missing', () => {
    const evalCase = makeCase({ shouldHaveEvidence: false, expectedEvidenceKeywords: ['7.0'] })
    const result = makeAnswer({ confidence: 'high', evidences: [makeEvidence()] })
    expect(classifyFailure(evalCase, result, false, null, true)).toBe('answer_unsupported')
  })

  it('classifies wrong_section', () => {
    const evalCase = makeCase({ shouldHaveEvidence: false, expectedEvidenceKeywords: [] })
    const result = makeAnswer({ confidence: 'high', evidences: [makeEvidence()] })
    expect(classifyFailure(evalCase, result, true, false, true)).toBe('wrong_section')
  })

  it('returns null when nothing is wrong', () => {
    const evalCase = makeCase({ shouldHaveEvidence: false, expectedEvidenceKeywords: [] })
    const result = makeAnswer({ confidence: 'high', evidences: [makeEvidence()] })
    expect(classifyFailure(evalCase, result, true, null, true)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// scoreCase (integration)
// ---------------------------------------------------------------------------

describe('scoreCase', () => {
  it('returns PASS for a correct grounded answer with matching section', () => {
    const evalCase = makeCase()
    const answer = makeAnswer({
      confidence: 'high',
      evidences: [makeEvidence({ sectionTitle: '3.1 Inclusion Criteria', excerpt: 'HbA1c 7.0 to 10.0%' })],
    })
    const result = scoreCase(evalCase, answer, 500)

    expect(result.status).toBe('PASS')
    expect(result.caseId).toBe('SM-001')
    expect(result.failureType).toBeNull()
    expect(result.insufficientEvidenceCorrect).toBe(true)
    expect(result.matchedExpectedKeywords).toBe(true)
    expect(result.matchedExpectedSection).toBe(true)
  })

  it('returns FAIL for adversarial case that got a grounded answer', () => {
    const evalCase = makeCase({
      shouldBeInsufficientEvidence: true,
      shouldHaveEvidence: false,
      expectedEvidenceKeywords: [],
      expectedSectionTitle: null,
    })
    const answer = makeAnswer({
      confidence: 'high',
      evidences: [makeEvidence({ excerpt: 'some content' })],
    })
    const result = scoreCase(evalCase, answer, 300)

    expect(result.status).toBe('FAIL')
    expect(result.failureType).toBe('missed_insufficient_evidence')
    expect(result.insufficientEvidenceCorrect).toBe(false)
  })

  it('returns PASS for adversarial case that correctly returned insufficient_evidence', () => {
    const evalCase = makeCase({
      shouldBeInsufficientEvidence: true,
      shouldHaveEvidence: false,
      expectedEvidenceKeywords: [],
      expectedSectionTitle: null,
    })
    const answer = makeAnswer({ confidence: 'insufficient_evidence', evidences: [] })
    const result = scoreCase(evalCase, answer, 300)

    expect(result.status).toBe('PASS')
    expect(result.insufficientEvidenceCorrect).toBe(true)
  })

  it('answerSnippet is always capped at 300 characters', () => {
    const evalCase = makeCase({ expectedEvidenceKeywords: [] })
    const longAnswer = 'A'.repeat(1000)
    const answer = makeAnswer({
      answer: longAnswer,
      evidences: [makeEvidence({ sectionTitle: '3.1 Inclusion Criteria' })],
    })
    const result = scoreCase(evalCase, answer, 100)

    expect(result.answerSnippet.length).toBe(300)
  })

  it('returns FAIL when expected evidence is absent (retrieval_miss)', () => {
    const evalCase = makeCase({ shouldHaveEvidence: true, expectedSectionTitle: null, expectedEvidenceKeywords: [] })
    const answer = makeAnswer({ confidence: 'medium', evidences: [] })
    const result = scoreCase(evalCase, answer, 200)

    expect(result.status).toBe('FAIL')
    expect(result.failureType).toBe('retrieval_miss')
  })

  it('returns FAIL when keywords absent from answer and excerpts', () => {
    const evalCase = makeCase({
      expectedEvidenceKeywords: ['GLP-1'],
      expectedSectionTitle: null,
      shouldHaveEvidence: false,
    })
    // default answer text does not mention GLP-1
    const answer = makeAnswer({ answer: 'No relevant content here.', confidence: 'medium', evidences: [] })
    const result = scoreCase(evalCase, answer, 200)

    expect(result.status).toBe('FAIL')
    expect(result.failureType).toBe('answer_unsupported')
  })

  it('matchedExpectedSection is null when expectedSectionTitle is null', () => {
    const evalCase = makeCase({ expectedSectionTitle: null, expectedEvidenceKeywords: [] })
    const answer = makeAnswer({ confidence: 'high', evidences: [makeEvidence()] })
    const result = scoreCase(evalCase, answer, 100)

    expect(result.matchedExpectedSection).toBeNull()
  })
})
