import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted — mismas referencias de clase en el factory y al lanzar errores
// para que instanceof funcione correctamente dentro del route handler.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  class MockAnswerOrchestratorError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'AnswerOrchestratorError'
    }
  }

  return {
    AnswerOrchestratorError: MockAnswerOrchestratorError,
    generateAnswerForStudy: vi.fn(),
    // Default: always returns a valid 500 Response so tests don't crash when
    // handleApiError is called unexpectedly.
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockReturnValue(new Response('Internal Server Error', { status: 500 })),
  }
})

// Path relative to THIS test file → the orchestrator module.
// Depth: __tests__/ → answer-test/ → rag/ → api/ → app/ → web/ → lib/rag/...
vi.mock('../../../../../lib/rag/answer-orchestrator', () => ({
  generateAnswerForStudy: mocks.generateAnswerForStudy,
  AnswerOrchestratorError: mocks.AnswerOrchestratorError,
}))

vi.mock('@ichtys/auth', () => ({
  handleApiError: mocks.handleApiError,
}))

// ---------------------------------------------------------------------------
// Import post-mock
// ---------------------------------------------------------------------------

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STUDY_ID = crypto.randomUUID()
const BASE_URL = 'http://localhost/api/rag/answer-test'

function makeRequest(body: unknown, url = BASE_URL): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentVersionId: crypto.randomUUID(),
    pageStart: 1,
    pageEnd: 3,
    sectionTitle: 'Inclusion Criteria',
    excerpt: 'HbA1c must be between 7.0% and 10.0%.',
    ...overrides,
  }
}

function makeSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    answer: 'HbA1c must be between 7.0% and 10.0% at screening.',
    confidence: 'high',
    evidences: [makeEvidence()],
    retrievalCount: 3,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Feature flag disabled
// ---------------------------------------------------------------------------

describe('POST /api/rag/answer-test — feature flag disabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ENABLE_INTERNAL_RAG_ANSWER_TEST', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 404 when ENABLE_INTERNAL_RAG_ANSWER_TEST is not set to "true"', async () => {
    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'any' }))
    expect(res.status).toBe(404)
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Feature flag enabled — all other tests
// ---------------------------------------------------------------------------

describe('POST /api/rag/answer-test — feature flag enabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ENABLE_INTERNAL_RAG_ANSWER_TEST', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 200 with answer, confidence, evidences and retrievalCount when study is valid and chunks are sufficient', async () => {
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeSuccessResult())

    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'What is the HbA1c criterion?' }))
    const body = await res.json() as unknown

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      answer: expect.any(String),
      confidence: 'high',
      retrievalCount: 3,
    })
    const b = body as { evidences: unknown[] }
    expect(b.evidences.length).toBeGreaterThan(0)
  })

  it('returns 200 with insufficient_evidence and empty evidences when retrieval finds no chunks', async () => {
    mocks.generateAnswerForStudy.mockResolvedValueOnce({
      answer: 'I do not have sufficient information in the available documents to answer this question.',
      confidence: 'insufficient_evidence',
      evidences: [],
      retrievalCount: 0,
    })

    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'What is the primary endpoint?' }))
    const body = await res.json() as { confidence: string; evidences: unknown[] }

    expect(res.status).toBe(200)
    expect(body.confidence).toBe('insufficient_evidence')
    expect(body.evidences).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Parameter propagation
  // -------------------------------------------------------------------------

  it('propagates topK to the orchestration wrapper', async () => {
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeSuccessResult())

    await POST(makeRequest({ studyId: STUDY_ID, question: 'eligibility', topK: 5 }))

    expect(mocks.generateAnswerForStudy).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 5 }),
    )
  })

  it('propagates documentType to the orchestration wrapper', async () => {
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeSuccessResult())

    await POST(makeRequest({ studyId: STUDY_ID, question: 'sample handling', documentType: 'lab_manual' }))

    expect(mocks.generateAnswerForStudy).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'lab_manual' }),
    )
  })

  // -------------------------------------------------------------------------
  // orgId rejection
  // -------------------------------------------------------------------------

  it('returns 400 when body contains orgId', async () => {
    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'test', orgId: 'some-id' }))
    expect(res.status).toBe(400)
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })

  it('returns 400 when body contains organizationId', async () => {
    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'test', organizationId: 'some-id' }))
    expect(res.status).toBe(400)
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })

  it('returns 400 when body contains organization_id', async () => {
    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'test', organization_id: 'some-id' }))
    expect(res.status).toBe(400)
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })

  it('returns 400 when orgId appears as a query param', async () => {
    const url = `${BASE_URL}?orgId=some-id`
    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'test' }, url))
    expect(res.status).toBe(400)
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------

  it('returns 400 when studyId is missing', async () => {
    const res = await POST(makeRequest({ question: 'What is the HbA1c criterion?' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when studyId is not a UUID', async () => {
    const res = await POST(makeRequest({ studyId: 'not-a-uuid', question: 'test' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when question is empty', async () => {
    const res = await POST(makeRequest({ studyId: STUDY_ID, question: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when question is missing', async () => {
    const res = await POST(makeRequest({ studyId: STUDY_ID }))
    expect(res.status).toBe(400)
  })

  // -------------------------------------------------------------------------
  // Access denied
  // -------------------------------------------------------------------------

  it('returns 403 with generic message when study access is denied (no session)', async () => {
    mocks.generateAnswerForStudy.mockRejectedValueOnce(
      new mocks.AnswerOrchestratorError('access_denied', 'Study access check failed'),
    )

    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'eligibility' }))
    const text = await res.text()

    expect(res.status).toBe(403)
    expect(text).toBe('Study not found or access denied')
    expect(text).not.toContain('Study access check failed')
  })

  it('returns 403 when studyId does not belong to the active org', async () => {
    mocks.generateAnswerForStudy.mockRejectedValueOnce(
      new mocks.AnswerOrchestratorError('access_denied', 'Study not in org'),
    )

    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'eligibility' }))

    expect(res.status).toBe(403)
  })

  // -------------------------------------------------------------------------
  // Internal errors
  // -------------------------------------------------------------------------

  it('returns 500 with generic message when retriever or LLM fails internally', async () => {
    mocks.generateAnswerForStudy.mockRejectedValueOnce(
      new mocks.AnswerOrchestratorError('retrieval_error', 'embedding_provider_error — raw detail'),
    )

    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'eligibility' }))
    const text = await res.text()

    expect(res.status).toBe(500)
    expect(text).toBe('Internal Server Error')
    expect(text).not.toContain('embedding_provider_error')
    expect(text).not.toContain('raw detail')
  })

  it('returns 500 when answer generation fails', async () => {
    mocks.generateAnswerForStudy.mockRejectedValueOnce(
      new mocks.AnswerOrchestratorError('answer_generation_error', 'llm internal error details'),
    )

    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'eligibility' }))
    const text = await res.text()

    expect(res.status).toBe(500)
    expect(text).not.toContain('llm internal error details')
  })

  // -------------------------------------------------------------------------
  // Language
  // -------------------------------------------------------------------------

  it('passes Spanish question unchanged to wrapper and returns Spanish fallback', async () => {
    const spanishQuestion = '¿Cuál es el criterio de HbA1c para inclusión?'
    const spanishFallback = {
      answer: 'No tengo información suficiente en los documentos disponibles para responder esta pregunta.',
      confidence: 'insufficient_evidence',
      evidences: [],
      retrievalCount: 0,
    }
    mocks.generateAnswerForStudy.mockResolvedValueOnce(spanishFallback)

    const res = await POST(makeRequest({ studyId: STUDY_ID, question: spanishQuestion }))
    const body = await res.json() as { answer: string; confidence: string }

    expect(res.status).toBe(200)
    expect(body.confidence).toBe('insufficient_evidence')
    expect(body.answer).toBe(spanishFallback.answer)
    expect(mocks.generateAnswerForStudy).toHaveBeenCalledWith(
      expect.objectContaining({ question: spanishQuestion }),
    )
  })

  // -------------------------------------------------------------------------
  // Response shape — no internal details leaked
  // -------------------------------------------------------------------------

  it('response does not include orgId, orgId or raw prompt fields', async () => {
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeSuccessResult())

    const res = await POST(makeRequest({ studyId: STUDY_ID, question: 'eligibility' }))
    const body = await res.json() as Record<string, unknown>

    expect(body).not.toHaveProperty('orgId')
    expect(body).not.toHaveProperty('organizationId')
    expect(body).not.toHaveProperty('prompt')
    expect(body).not.toHaveProperty('embedding')
    expect(body).not.toHaveProperty('content')
  })
})
