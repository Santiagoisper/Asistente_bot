import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted — mismas referencias usadas en factories y al lanzar errores.
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

  class MockAnswerOrchestratorError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'AnswerOrchestratorError'
    }
  }

  const CONV_ID = crypto.randomUUID()
  const USER_MSG_ID = crypto.randomUUID()
  const ASST_MSG_ID = crypto.randomUUID()
  const ORG_ID = crypto.randomUUID()
  const STUDY_ID = crypto.randomUUID()
  const USER_ID = crypto.randomUUID()

  return {
    AccessError: MockAccessError,
    AnswerOrchestratorError: MockAnswerOrchestratorError,
    CONV_ID,
    USER_MSG_ID,
    ASST_MSG_ID,
    ORG_ID,
    STUDY_ID,
    USER_ID,
    validateStudyAccess: vi.fn(),
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockImplementation((err) => {
        if (err instanceof MockAccessError) {
          const status = err.status
          return new Response('Forbidden', { status })
        }
        return new Response('Internal Server Error', { status: 500 })
      }),
    generateAnswerForStudy: vi.fn(),
    getOrCreateConversation: vi.fn(),
    loadConversationHistory: vi.fn(),
    persistUserMessage: vi.fn(),
    persistAssistantMessageAndCitations: vi.fn(),
    writeAuditLog: vi.fn(),
    enforceSlidingWindowRateLimit: vi.fn(),
    rateLimitResponse: vi
      .fn<(retryAfterSeconds: number) => Response>()
      .mockImplementation((retryAfterSeconds) =>
        new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        }),
      ),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateStudyAccess: mocks.validateStudyAccess,
  handleApiError: mocks.handleApiError,
  AccessError: mocks.AccessError,
}))

vi.mock('../../../../lib/rag/answer-orchestrator', () => ({
  generateAnswerForStudy: mocks.generateAnswerForStudy,
  AnswerOrchestratorError: mocks.AnswerOrchestratorError,
}))

vi.mock('../../../../lib/chat/persistence', () => ({
  getOrCreateConversation: mocks.getOrCreateConversation,
  loadConversationHistory: mocks.loadConversationHistory,
  persistUserMessage: mocks.persistUserMessage,
  persistAssistantMessageAndCitations: mocks.persistAssistantMessageAndCitations,
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock('../../../../lib/security/rate-limit', () => ({
  enforceSlidingWindowRateLimit: mocks.enforceSlidingWindowRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  getChatRateLimitConfig: () => ({ limit: 30, windowSeconds: 60 }),
}))

// ---------------------------------------------------------------------------
// Import post-mock
// ---------------------------------------------------------------------------

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost/api/chat'

function makeRequest(body: unknown, url = BASE_URL): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeStudyAccessCtx() {
  return { userId: mocks.USER_ID, orgId: mocks.ORG_ID, study: { id: mocks.STUDY_ID } }
}

function makeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentVersionId: crypto.randomUUID(),
    pageStart: 1,
    pageEnd: 3,
    sectionTitle: 'Eligibility',
    excerpt: 'HbA1c must be ≥7.0% at screening.',
    ...overrides,
  }
}

function makeWrapperResult(overrides: Record<string, unknown> = {}) {
  return {
    answer: 'HbA1c must be between 7.0% and 10.0%.',
    confidence: 'high' as const,
    evidences: [makeEvidence()],
    retrievalCount: 4,
    ...overrides,
  }
}

function setupHappyPath() {
  mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
  mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
  mocks.loadConversationHistory.mockResolvedValueOnce([])
  mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
  mocks.generateAnswerForStudy.mockResolvedValueOnce(makeWrapperResult())
  mocks.persistAssistantMessageAndCitations.mockResolvedValueOnce(mocks.ASST_MSG_ID)
  mocks.writeAuditLog.mockResolvedValue(undefined)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: false })
  mocks.loadConversationHistory.mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

// ---------------------------------------------------------------------------
// Happy path — new conversation
// ---------------------------------------------------------------------------

describe('POST /api/chat — happy path (new conversation)', () => {
  it('creates conversation, persists user and assistant messages, returns full response', async () => {
    setupHappyPath()

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'What is HbA1c criterion?' }))
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.conversationId).toBe(mocks.CONV_ID)
    expect(body.userMessageId).toBe(mocks.USER_MSG_ID)
    expect(body.assistantMessageId).toBe(mocks.ASST_MSG_ID)
    expect(body.answer).toBeTruthy()
    expect(body.confidence).toBe('high')
    expect(Array.isArray(body.evidences)).toBe(true)
    expect((body.evidences as unknown[]).length).toBeGreaterThan(0)
    expect(typeof body.retrievalCount).toBe('number')
  })

  it('calls getOrCreateConversation with undefined conversationId when not provided', async () => {
    setupHappyPath()

    await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    expect(mocks.getOrCreateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: undefined }),
    )
  })

  it('loads conversation history with tenant boundary and passes it to the answer engine', async () => {
    const history = [
      { role: 'user', content: '¿Qué procedimientos tiene la visita 4?' },
      { role: 'assistant', content: 'La visita 4 incluye HbA1c y muestra PK [1].' },
    ]
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.loadConversationHistory.mockResolvedValueOnce(history)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeWrapperResult())
    mocks.persistAssistantMessageAndCitations.mockResolvedValueOnce(mocks.ASST_MSG_ID)
    mocks.writeAuditLog.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: '¿Y la visita 5?' }))

    expect(res.status).toBe(200)
    expect(mocks.loadConversationHistory).toHaveBeenCalledWith({
      conversationId: mocks.CONV_ID,
      orgId: mocks.ORG_ID,
      studyId: mocks.STUDY_ID,
    })
    expect(mocks.generateAnswerForStudy).toHaveBeenCalledWith(
      expect.objectContaining({ conversationHistory: history }),
    )
  })

  it('loads history BEFORE persisting the new user message (current turn not duplicated)', async () => {
    const order: string[] = []
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.loadConversationHistory.mockImplementationOnce(async () => { order.push('history'); return [] })
    mocks.persistUserMessage.mockImplementationOnce(async () => { order.push('user-message'); return mocks.USER_MSG_ID })
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeWrapperResult())
    mocks.persistAssistantMessageAndCitations.mockResolvedValueOnce(mocks.ASST_MSG_ID)
    mocks.writeAuditLog.mockResolvedValue(undefined)

    await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    expect(order).toEqual(['history', 'user-message'])
  })
})

// ---------------------------------------------------------------------------
// Happy path — existing conversation
// ---------------------------------------------------------------------------

describe('POST /api/chat — existing conversationId', () => {
  it('passes conversationId to getOrCreateConversation for validation', async () => {
    const existingConvId = crypto.randomUUID()
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(existingConvId)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeWrapperResult())
    mocks.persistAssistantMessageAndCitations.mockResolvedValueOnce(mocks.ASST_MSG_ID)
    mocks.writeAuditLog.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test', conversationId: existingConvId }))

    expect(res.status).toBe(200)
    expect(mocks.getOrCreateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: existingConvId }),
    )
  })
})

// ---------------------------------------------------------------------------
// insufficient_evidence — persists message, no citations
// ---------------------------------------------------------------------------

describe('POST /api/chat — insufficient_evidence', () => {
  it('returns 200 with insufficient_evidence and empty evidences', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.generateAnswerForStudy.mockResolvedValueOnce({
      answer: 'I do not have sufficient information in the available documents to answer this question.',
      confidence: 'insufficient_evidence',
      evidences: [],
      retrievalCount: 0,
    })
    mocks.persistAssistantMessageAndCitations.mockResolvedValueOnce(mocks.ASST_MSG_ID)
    mocks.writeAuditLog.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'unknown topic' }))
    const body = await res.json() as { confidence: string; evidences: unknown[] }

    expect(res.status).toBe(200)
    expect(body.confidence).toBe('insufficient_evidence')
    expect(body.evidences).toEqual([])
    // persistAssistantMessageAndCitations still called (with empty evidences)
    expect(mocks.persistAssistantMessageAndCitations).toHaveBeenCalledWith(
      expect.objectContaining({ evidences: [] }),
    )
  })
})

// ---------------------------------------------------------------------------
// orgId rejection
// ---------------------------------------------------------------------------

describe('POST /api/chat — orgId rejection', () => {
  it('returns 400 when body contains orgId', async () => {
    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test', orgId: 'x' }))
    expect(res.status).toBe(400)
    expect(mocks.validateStudyAccess).not.toHaveBeenCalled()
  })

  it('returns 400 when body contains organizationId', async () => {
    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test', organizationId: 'x' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body contains organization_id', async () => {
    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test', organization_id: 'x' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when orgId appears as query param', async () => {
    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }, `${BASE_URL}?orgId=x`))
    expect(res.status).toBe(400)
  })

  it('returns 400 when organizationId appears as query param', async () => {
    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }, `${BASE_URL}?organizationId=x`))
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('POST /api/chat — input validation', () => {
  it('returns 400 when studyId is missing', async () => {
    const res = await POST(makeRequest({ question: 'test' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when studyId is not a UUID', async () => {
    const res = await POST(makeRequest({ studyId: 'not-a-uuid', question: 'test' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when question is missing', async () => {
    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when question is empty string', async () => {
    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: '' }))
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Access denied
// ---------------------------------------------------------------------------

describe('POST /api/chat — access denied', () => {
  it('returns 401/403 when validateStudyAccess throws', async () => {
    mocks.validateStudyAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    expect([401, 403, 404]).toContain(res.status)
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })

  it('returns 403/404 when conversation does not belong to org/study/user', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockRejectedValueOnce(
      new mocks.AccessError('Conversation not found or access denied', 404),
    )

    const res = await POST(makeRequest({
      studyId: mocks.STUDY_ID,
      question: 'test',
      conversationId: crypto.randomUUID(),
    }))

    expect([403, 404]).toContain(res.status)
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe('POST /api/chat - rate limiting', () => {
  it('returns 429 with Retry-After when the user+study window is exhausted', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.enforceSlidingWindowRateLimit.mockResolvedValueOnce({
      limited: true,
      retryAfterSeconds: 12,
    })

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('12')
    expect(mocks.enforceSlidingWindowRateLimit).toHaveBeenCalledWith({
      key: `chat:${mocks.USER_ID}:${mocks.STUDY_ID}`,
      limit: 30,
      windowSeconds: 60,
    })
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled()
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Parameter propagation
// ---------------------------------------------------------------------------

describe('POST /api/chat — parameter propagation', () => {
  it('propagates documentType to generateAnswerForStudy', async () => {
    setupHappyPath()

    await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'lab procedures', documentType: 'lab_manual' }))

    expect(mocks.generateAnswerForStudy).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'lab_manual' }),
    )
  })

  it('propagates topK to generateAnswerForStudy', async () => {
    setupHappyPath()

    await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'eligibility', topK: 10 }))

    expect(mocks.generateAnswerForStudy).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 10 }),
    )
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('POST /api/chat — error handling', () => {
  it('returns 500 and calls writeAuditLog(rag.answer.failed) when wrapper fails', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.generateAnswerForStudy.mockRejectedValueOnce(new Error('llm_provider_error'))
    mocks.writeAuditLog.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))
    const text = await res.text()

    expect(res.status).toBe(500)
    expect(text).toBe('Internal Server Error')
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rag.answer.failed' }),
    )
    expect(mocks.persistAssistantMessageAndCitations).not.toHaveBeenCalled()
  })

  it('returns 500 when persistAssistantMessageAndCitations fails (no partial success)', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeWrapperResult())
    mocks.persistAssistantMessageAndCitations.mockRejectedValueOnce(new Error('TX failed'))
    mocks.writeAuditLog.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    expect(res.status).toBe(500)
  })

  it('returns 500 when mandatory rag.answer.requested audit fails', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.writeAuditLog.mockRejectedValueOnce(new Error('audit unavailable'))

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    expect(res.status).toBe(500)
    expect(mocks.generateAnswerForStudy).not.toHaveBeenCalled()
  })

  it('returns 500 when mandatory rag.answer.completed audit fails', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.generateAnswerForStudy.mockResolvedValueOnce(makeWrapperResult())
    mocks.persistAssistantMessageAndCitations.mockResolvedValueOnce(mocks.ASST_MSG_ID)
    mocks.writeAuditLog
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('audit unavailable'))

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

describe('POST /api/chat — audit logs', () => {
  it('writes rag.answer.requested before calling generateAnswerForStudy', async () => {
    const callOrder: string[] = []
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.writeAuditLog.mockImplementation(async (p: { action: string }) => {
      callOrder.push(p.action)
    })
    mocks.generateAnswerForStudy.mockImplementation(async () => {
      callOrder.push('generateAnswerForStudy')
      return makeWrapperResult()
    })
    mocks.persistAssistantMessageAndCitations.mockResolvedValueOnce(mocks.ASST_MSG_ID)

    await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    const requestedIdx = callOrder.indexOf('rag.answer.requested')
    const generateIdx = callOrder.indexOf('generateAnswerForStudy')
    expect(requestedIdx).toBeGreaterThanOrEqual(0)
    expect(generateIdx).toBeGreaterThanOrEqual(0)
    expect(requestedIdx).toBeLessThan(generateIdx)
  })

  it('writes rag.answer.completed with safe metadata after successful persistence', async () => {
    setupHappyPath()

    await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'test' }))

    const completedCall = mocks.writeAuditLog.mock.calls.find(
      (call) => (call[0] as { action: string }).action === 'rag.answer.completed'
    )
    expect(completedCall).toBeDefined()
    const metadata = (completedCall![0] as { metadata: Record<string, unknown> }).metadata
    expect(metadata).toMatchObject({
      confidence: expect.any(String),
      evidenceCount: expect.any(Number),
      retrievalCount: expect.any(Number),
    })
    // No PHI in audit metadata
    expect(JSON.stringify(metadata)).not.toContain('question')
    expect(JSON.stringify(metadata)).not.toContain('answer')
  })

  it('writes rag.answer.requested without question text (no PHI in audit)', async () => {
    setupHappyPath()

    const question = 'Sensitive patient question about HbA1c 9.2%'
    await POST(makeRequest({ studyId: mocks.STUDY_ID, question }))

    const requestedCall = mocks.writeAuditLog.mock.calls.find(
      (call) => (call[0] as { action: string }).action === 'rag.answer.requested'
    )
    const metadata = (requestedCall![0] as { metadata?: Record<string, unknown> }).metadata ?? {}
    expect(JSON.stringify(metadata)).not.toContain('HbA1c')
    expect(JSON.stringify(metadata)).not.toContain('9.2%')
    expect(JSON.stringify(metadata)).not.toContain('Sensitive')
  })
})

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

describe('POST /api/chat — language', () => {
  it('passes Spanish question unchanged so fallback is in Spanish', async () => {
    const spanishQ = '¿Cuál es el criterio de HbA1c?'
    const spanishFallback = {
      answer: 'No tengo información suficiente en los documentos disponibles para responder esta pregunta.',
      confidence: 'insufficient_evidence' as const,
      evidences: [],
      retrievalCount: 0,
    }
    mocks.validateStudyAccess.mockResolvedValueOnce(makeStudyAccessCtx())
    mocks.getOrCreateConversation.mockResolvedValueOnce(mocks.CONV_ID)
    mocks.persistUserMessage.mockResolvedValueOnce(mocks.USER_MSG_ID)
    mocks.generateAnswerForStudy.mockResolvedValueOnce(spanishFallback)
    mocks.persistAssistantMessageAndCitations.mockResolvedValueOnce(mocks.ASST_MSG_ID)
    mocks.writeAuditLog.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: spanishQ }))
    const body = await res.json() as { answer: string; confidence: string }

    expect(res.status).toBe(200)
    expect(body.confidence).toBe('insufficient_evidence')
    expect(body.answer).toBe(spanishFallback.answer)
    expect(mocks.generateAnswerForStudy).toHaveBeenCalledWith(
      expect.objectContaining({ question: spanishQ }),
    )
  })
})

// ---------------------------------------------------------------------------
// Response shape — no internal data leaked
// ---------------------------------------------------------------------------

describe('POST /api/chat — response shape', () => {
  it('response does not include prompts, embeddings or raw chunk content', async () => {
    setupHappyPath()

    const res = await POST(makeRequest({ studyId: mocks.STUDY_ID, question: 'eligibility' }))
    const body = await res.json() as Record<string, unknown>

    expect(body).not.toHaveProperty('prompt')
    expect(body).not.toHaveProperty('embedding')
    expect(body).not.toHaveProperty('orgId')
    expect(body).not.toHaveProperty('organizationId')
    // Evidences present but not full chunk content
    expect(body).toHaveProperty('evidences')
    expect(body).toHaveProperty('conversationId')
    expect(body).toHaveProperty('userMessageId')
    expect(body).toHaveProperty('assistantMessageId')
  })
})
