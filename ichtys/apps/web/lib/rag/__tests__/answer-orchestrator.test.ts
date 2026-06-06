import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted — deben declararse antes de cualquier import del módulo bajo prueba.
// La misma referencia de clase se usa en el mock factory Y al lanzar errores,
// garantizando que `instanceof` funcione correctamente.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403 | 404,
    ) {
      super(message)
      this.name = 'AccessError'
    }
  }

  class MockAnswerEngineError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'AnswerEngineError'
    }
  }

  return {
    AccessError: MockAccessError,
    AnswerEngineError: MockAnswerEngineError,
    validateStudyAccess: vi.fn(),
    retrieveRelevantChunks: vi.fn(),
    answerEngine: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateStudyAccess: mocks.validateStudyAccess,
  AccessError: mocks.AccessError,
}))

vi.mock('@ichtys/rag', () => ({
  retrieveRelevantChunks: mocks.retrieveRelevantChunks,
  answerEngine: mocks.answerEngine,
  AnswerEngineError: mocks.AnswerEngineError,
}))

// @ichtys/db solo provee tipos en este módulo — no se necesita mock de DB.

// ---------------------------------------------------------------------------
// Import post-mock
// ---------------------------------------------------------------------------

import {
  generateAnswerForStudy,
  AnswerOrchestratorError,
} from '../answer-orchestrator'
import type { GenerateAnswerForStudyInput } from '../answer-orchestrator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = crypto.randomUUID()
const STUDY_ID = crypto.randomUUID()
const USER_ID = crypto.randomUUID()

function makeInput(overrides: Partial<GenerateAnswerForStudyInput> = {}): GenerateAnswerForStudyInput {
  return {
    studyId: STUDY_ID,
    question: 'What are the eligibility criteria for HbA1c?',
    ...overrides,
  }
}

function makeStudyAccessContext() {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    study: { id: STUDY_ID, organizationId: ORG_ID },
  }
}

function makeRetrievedChunk(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentVersionId: crypto.randomUUID(),
    documentType: 'protocol',
    pageStart: 1,
    pageEnd: 3,
    sectionTitle: 'Inclusion Criteria',
    content: 'HbA1c must be between 7.0% and 10.0% at screening.',
    similarityScore: 0.92,
    ...overrides,
  }
}

function makeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentVersionId: crypto.randomUUID(),
    pageStart: 1,
    pageEnd: 3,
    sectionTitle: 'Inclusion Criteria',
    excerpt: 'HbA1c must be between 7.0% and 10.0% at screening.',
    ...overrides,
  }
}

function makeAnswerResult(overrides: Record<string, unknown> = {}) {
  return {
    answer: 'HbA1c must be between 7.0% and 10.0% at screening.',
    confidence: 'high' as const,
    evidences: [makeEvidence()],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Happy path — valid study + sufficient chunks
// ---------------------------------------------------------------------------

describe('generateAnswerForStudy — happy path', () => {
  it('returns answer with evidences and retrievalCount when study is valid and chunks are sufficient', async () => {
    const chunks = [makeRetrievedChunk(), makeRetrievedChunk(), makeRetrievedChunk()]
    const answerResult = makeAnswerResult()
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockResolvedValueOnce(chunks)
    mocks.answerEngine.mockResolvedValueOnce(answerResult)

    const result = await generateAnswerForStudy(makeInput())

    expect(result.confidence).toBe('high')
    expect(result.evidences).toHaveLength(1)
    expect(result.retrievalCount).toBe(3)
    expect(result.answer).toBe(answerResult.answer)
  })

  it('returns insufficient_evidence with empty evidences when retrieval returns no chunks', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockResolvedValueOnce([])
    mocks.answerEngine.mockResolvedValueOnce({
      answer: 'I do not have sufficient information in the available documents to answer this question.',
      confidence: 'insufficient_evidence',
      evidences: [],
    })

    const result = await generateAnswerForStudy(makeInput())

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.evidences).toEqual([])
    expect(result.retrievalCount).toBe(0)
  })

  it('includes retrievalCount equal to the number of chunks returned by retriever', async () => {
    const chunks = Array.from({ length: 6 }, () => makeRetrievedChunk())
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockResolvedValueOnce(chunks)
    mocks.answerEngine.mockResolvedValueOnce(makeAnswerResult())

    const result = await generateAnswerForStudy(makeInput())

    expect(result.retrievalCount).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// Propagation — documentType and topK
// ---------------------------------------------------------------------------

describe('generateAnswerForStudy — parameter propagation', () => {
  it('propagates documentType to retrieveRelevantChunks', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockResolvedValueOnce([])
    mocks.answerEngine.mockResolvedValueOnce({
      answer: 'fallback',
      confidence: 'insufficient_evidence',
      evidences: [],
    })

    await generateAnswerForStudy(makeInput({ documentType: 'lab_manual' }))

    expect(mocks.retrieveRelevantChunks).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'lab_manual' }),
    )
  })

  it('propagates topK to retrieveRelevantChunks', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockResolvedValueOnce([])
    mocks.answerEngine.mockResolvedValueOnce({
      answer: 'fallback',
      confidence: 'insufficient_evidence',
      evidences: [],
    })

    await generateAnswerForStudy(makeInput({ topK: 12 }))

    expect(mocks.retrieveRelevantChunks).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 12 }),
    )
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('generateAnswerForStudy — error sanitization', () => {
  it('throws AnswerOrchestratorError access_denied when validateStudyAccess throws AccessError', async () => {
    mocks.validateStudyAccess.mockRejectedValueOnce(
      new mocks.AccessError('Study not found or access denied', 404),
    )

    await expect(generateAnswerForStudy(makeInput())).rejects.toBeInstanceOf(AnswerOrchestratorError)
    await expect(generateAnswerForStudy(makeInput())).rejects.toMatchObject({
      code: 'access_denied',
    })
  })

  it('throws AnswerOrchestratorError access_denied for any validateStudyAccess failure', async () => {
    mocks.validateStudyAccess.mockRejectedValueOnce(new Error('Unexpected DB connection error'))

    await expect(generateAnswerForStudy(makeInput())).rejects.toMatchObject({
      code: 'access_denied',
    })
  })

  it('does not expose internal access error details to the caller', async () => {
    mocks.validateStudyAccess.mockRejectedValueOnce(
      new mocks.AccessError('clerk_org_id=org_secret internal detail', 401),
    )

    try {
      await generateAnswerForStudy(makeInput())
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AnswerOrchestratorError)
      const orchestratorErr = err as AnswerOrchestratorError
      expect(orchestratorErr.message).not.toContain('clerk_org_id')
      expect(orchestratorErr.message).not.toContain('internal detail')
    }
  })

  it('throws AnswerOrchestratorError retrieval_error when retrieveRelevantChunks throws', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockRejectedValueOnce(new Error('embedding_provider_error'))

    await expect(generateAnswerForStudy(makeInput())).rejects.toMatchObject({
      code: 'retrieval_error',
    })
    expect(mocks.answerEngine).not.toHaveBeenCalled()
  })

  it('throws AnswerOrchestratorError answer_generation_error when answerEngine throws', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockResolvedValueOnce([makeRetrievedChunk()])
    mocks.answerEngine.mockRejectedValueOnce(
      new mocks.AnswerEngineError('llm_provider_error', 'Provider failed'),
    )

    await expect(generateAnswerForStudy(makeInput())).rejects.toMatchObject({
      code: 'answer_generation_error',
    })
  })
})

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe('generateAnswerForStudy — tenant isolation', () => {
  it('resolves orgId from validateStudyAccess, never from input', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockResolvedValueOnce([])
    mocks.answerEngine.mockResolvedValueOnce({
      answer: 'fallback',
      confidence: 'insufficient_evidence',
      evidences: [],
    })

    await generateAnswerForStudy(makeInput())

    // Proof: orgId in the retrieval call came from validateStudyAccess (ORG_ID),
    // not from the input (which has no orgId field).
    expect(mocks.validateStudyAccess).toHaveBeenCalledWith(STUDY_ID)
    expect(mocks.retrieveRelevantChunks).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID }),
    )
  })

  it('passes the correct studyId to the retriever', async () => {
    const customStudyId = crypto.randomUUID()
    mocks.validateStudyAccess.mockResolvedValueOnce({ ...makeStudyAccessContext(), study: { id: customStudyId } })
    mocks.retrieveRelevantChunks.mockResolvedValueOnce([])
    mocks.answerEngine.mockResolvedValueOnce({
      answer: 'fallback',
      confidence: 'insufficient_evidence',
      evidences: [],
    })

    await generateAnswerForStudy(makeInput({ studyId: customStudyId }))

    expect(mocks.retrieveRelevantChunks).toHaveBeenCalledWith(
      expect.objectContaining({ studyId: customStudyId }),
    )
  })
})

// ---------------------------------------------------------------------------
// Language — fallback respects question language
// ---------------------------------------------------------------------------

describe('generateAnswerForStudy — language', () => {
  it('passes the question unchanged to answerEngine so language-aware fallback works', async () => {
    const spanishQuestion = '¿Cuál es el criterio de HbA1c para inclusión?'
    const spanishFallback = {
      answer: 'No tengo información suficiente en los documentos disponibles para responder esta pregunta.',
      confidence: 'insufficient_evidence' as const,
      evidences: [],
    }
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessContext())
    mocks.retrieveRelevantChunks.mockResolvedValueOnce([])
    mocks.answerEngine.mockResolvedValueOnce(spanishFallback)

    const result = await generateAnswerForStudy(makeInput({ question: spanishQuestion }))

    // Verify the question was passed through without modification
    expect(mocks.answerEngine).toHaveBeenCalledWith(
      expect.objectContaining({ question: spanishQuestion }),
    )
    // Verify the Spanish answer passed through unchanged
    expect(result.answer).toBe(spanishFallback.answer)
    expect(result.confidence).toBe('insufficient_evidence')
  })
})
