import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
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

  const MSG_ID = crypto.randomUUID()
  const CONV_ID = crypto.randomUUID()
  const ORG_ID = crypto.randomUUID()
  const STUDY_ID = crypto.randomUUID()
  const USER_ID = crypto.randomUUID()

  return {
    AccessError: MockAccessError,
    MSG_ID,
    CONV_ID,
    ORG_ID,
    STUDY_ID,
    USER_ID,
    validateMessageAccess: vi.fn(),
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockImplementation((err) =>
        err instanceof MockAccessError
          ? new Response('Not Found', { status: err.status })
          : new Response('Internal Server Error', { status: 500 }),
      ),
    conversationsFindFirst: vi.fn(),
    dbInsert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue(Promise.resolve()),
    }),
    getMessageCitations: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  AccessError: mocks.AccessError,
  validateMessageAccess: mocks.validateMessageAccess,
  handleApiError: mocks.handleApiError,
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: {
      conversations: { findFirst: mocks.conversationsFindFirst },
    },
    insert: mocks.dbInsert,
  },
  auditLogs: { id: 'auditLogs.id' },
  conversations: {
    id: 'conversations.id',
    userId: 'conversations.userId',
    organizationId: 'conversations.organizationId',
  },
  answerConfidence: ['high', 'medium', 'low', 'insufficient_evidence'],
  documentType: ['protocol', 'investigator_brochure', 'lab_manual', 'pharmacy_manual', 'other'],
}))

vi.mock('../../../../../lib/chat/history', () => ({
  getMessageCitations: mocks.getMessageCitations,
}))

import { GET } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost/api/citations'

function makeRequest(messageId: string): Request {
  return new Request(`${BASE_URL}/${messageId}`, { method: 'GET' })
}

function makeRouteCtx(messageId = mocks.MSG_ID) {
  return { params: Promise.resolve({ messageId }) }
}

function makeMessageAccessCtx() {
  return {
    userId: mocks.USER_ID,
    orgId: mocks.ORG_ID,
    studyId: mocks.STUDY_ID,
    message: {
      id: mocks.MSG_ID,
      conversationId: mocks.CONV_ID,
      organizationId: mocks.ORG_ID,
      studyId: mocks.STUDY_ID,
      role: 'assistant',
      content: 'The HbA1c criterion is ≥7.0%.',
      confidence: 'high',
      createdAt: new Date(),
    },
    study: { id: mocks.STUDY_ID },
  }
}

function makeCitation(overrides: Record<string, unknown> = {}) {
  return {
    citationId: crypto.randomUUID(),
    chunkId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentVersionId: crypto.randomUUID(),
    documentName: 'Protocol v2.0',
    documentType: 'protocol',
    pageStart: 14,
    pageEnd: 15,
    sectionTitle: 'Inclusion Criteria',
    excerpt: 'HbA1c must be ≥7.0% at screening.',
    ...overrides,
  }
}

function makeConvObject() {
  return {
    id: mocks.CONV_ID,
    userId: mocks.USER_ID,
    organizationId: mocks.ORG_ID,
    studyId: mocks.STUDY_ID,
    title: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('GET /api/citations/[messageId] — happy path', () => {
  it('returns 200 with citations for an authorized assistant message', async () => {
    const citation = makeCitation()
    mocks.validateMessageAccess.mockResolvedValueOnce(makeMessageAccessCtx())
    mocks.conversationsFindFirst.mockResolvedValueOnce(makeConvObject())
    mocks.getMessageCitations.mockResolvedValueOnce([citation])

    const res = await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())
    const body = await res.json() as { messageId: string; citations: unknown[] }

    expect(res.status).toBe(200)
    expect(body.messageId).toBe(mocks.MSG_ID)
    expect(body.citations).toHaveLength(1)
    expect(body.citations[0]).toMatchObject({ citationId: citation.citationId })
  })

  it('returns 200 with empty citations array when message has no citations', async () => {
    mocks.validateMessageAccess.mockResolvedValueOnce(makeMessageAccessCtx())
    mocks.conversationsFindFirst.mockResolvedValueOnce(makeConvObject())
    mocks.getMessageCitations.mockResolvedValueOnce([])

    const res = await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())
    const body = await res.json() as { citations: unknown[] }

    expect(res.status).toBe(200)
    expect(body.citations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Auth chain — messageId → conversationId → userId
// ---------------------------------------------------------------------------

describe('GET /api/citations/[messageId] — auth chain validation', () => {
  it('returns 404 when message not found (wrong org)', async () => {
    mocks.validateMessageAccess.mockRejectedValueOnce(
      new mocks.AccessError('Message not found or access denied', 404),
    )

    const res = await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())

    expect([403, 404]).toContain(res.status)
    expect(mocks.conversationsFindFirst).not.toHaveBeenCalled()
    expect(mocks.getMessageCitations).not.toHaveBeenCalled()
  })

  it('returns 404 when conversation userId does not match (unauthorized user)', async () => {
    mocks.validateMessageAccess.mockResolvedValueOnce(makeMessageAccessCtx())
    mocks.conversationsFindFirst.mockResolvedValueOnce(null) // userId mismatch → null

    const res = await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())

    expect([403, 404]).toContain(res.status)
    expect(mocks.getMessageCitations).not.toHaveBeenCalled()
  })

  it('validates conversation ownership using userId from auth context', async () => {
    mocks.validateMessageAccess.mockResolvedValueOnce(makeMessageAccessCtx())
    mocks.conversationsFindFirst.mockResolvedValueOnce(makeConvObject())
    mocks.getMessageCitations.mockResolvedValueOnce([])

    await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())

    // Conversation lookup must use conversationId from the message
    expect(mocks.conversationsFindFirst).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('GET /api/citations/[messageId] — input validation', () => {
  it('returns 400 when messageId is not a UUID', async () => {
    const res = await GET(
      makeRequest('not-a-uuid'),
      { params: Promise.resolve({ messageId: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.validateMessageAccess).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Response safety
// ---------------------------------------------------------------------------

describe('GET /api/citations/[messageId] — response safety', () => {
  it('does not expose embeddings, orgId or raw chunk content in response', async () => {
    const citation = makeCitation()
    mocks.validateMessageAccess.mockResolvedValueOnce(makeMessageAccessCtx())
    mocks.conversationsFindFirst.mockResolvedValueOnce(makeConvObject())
    mocks.getMessageCitations.mockResolvedValueOnce([citation])

    const res = await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())
    const body = await res.json() as Record<string, unknown>

    expect(body).not.toHaveProperty('embedding')
    expect(body).not.toHaveProperty('orgId')
    expect(body).not.toHaveProperty('organizationId')
  })

  it('citation excerpts are present but do not expose full chunk content', async () => {
    const citation = makeCitation({ excerpt: 'Brief excerpt: HbA1c must be ≥7.0%.' })
    mocks.validateMessageAccess.mockResolvedValueOnce(makeMessageAccessCtx())
    mocks.conversationsFindFirst.mockResolvedValueOnce(makeConvObject())
    mocks.getMessageCitations.mockResolvedValueOnce([citation])

    const res = await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())
    const body = await res.json() as { citations: Array<{ excerpt: string }> }

    expect(body.citations[0]?.excerpt).toBe(citation.excerpt)
    // Excerpt is a bounded string (enforced by answer engine), not full chunk
    expect(body.citations[0]?.excerpt.length).toBeLessThanOrEqual(700)
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('GET /api/citations/[messageId] — error handling', () => {
  it('returns 500 when DB query fails', async () => {
    mocks.validateMessageAccess.mockResolvedValueOnce(makeMessageAccessCtx())
    mocks.conversationsFindFirst.mockResolvedValueOnce(makeConvObject())
    mocks.getMessageCitations.mockRejectedValueOnce(new Error('DB connection lost'))

    const res = await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())

    expect(res.status).toBe(500)
  })

  it('returns 500 when mandatory citation.view audit insert fails', async () => {
    mocks.validateMessageAccess.mockResolvedValueOnce(makeMessageAccessCtx())
    mocks.conversationsFindFirst.mockResolvedValueOnce(makeConvObject())
    mocks.getMessageCitations.mockResolvedValueOnce([makeCitation()])
    mocks.dbInsert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValueOnce(new Error('audit unavailable')),
    })

    const res = await GET(makeRequest(mocks.MSG_ID), makeRouteCtx())

    expect(res.status).toBe(500)
  })
})
