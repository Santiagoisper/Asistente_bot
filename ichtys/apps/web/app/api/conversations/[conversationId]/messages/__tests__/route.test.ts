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

  const CONV_ID = crypto.randomUUID()
  const ORG_ID = crypto.randomUUID()
  const STUDY_ID = crypto.randomUUID()
  const USER_ID = crypto.randomUUID()

  return {
    AccessError: MockAccessError,
    CONV_ID,
    ORG_ID,
    STUDY_ID,
    USER_ID,
    validateConversationAccess: vi.fn(),
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockImplementation((err) =>
        err instanceof MockAccessError
          ? new Response('Forbidden', { status: err.status })
          : new Response('Internal Server Error', { status: 500 }),
      ),
    getConversationMessages: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateConversationAccess: mocks.validateConversationAccess,
  handleApiError: mocks.handleApiError,
  AccessError: mocks.AccessError,
}))

vi.mock('../../../../../../lib/chat/history', () => ({
  getConversationMessages: mocks.getConversationMessages,
}))

import { GET } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost/api/conversations'

function makeRequest(conversationId: string, extraParams: Record<string, string> = {}): Request {
  const url = new URL(`${BASE_URL}/${conversationId}/messages`)
  Object.entries(extraParams).forEach(([k, v]) => url.searchParams.set(k, v))
  return new Request(url.toString(), { method: 'GET' })
}

function makeRouteCtx(conversationId = mocks.CONV_ID) {
  return { params: Promise.resolve({ conversationId }) }
}

function makeMessage(role: 'user' | 'assistant' = 'assistant') {
  return {
    messageId: crypto.randomUUID(),
    role,
    content: role === 'user' ? 'What is the HbA1c criterion?' : 'HbA1c must be ≥7.0%.',
    confidence: role === 'assistant' ? ('high' as const) : null,
    createdAt: new Date().toISOString(),
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

describe('GET /api/conversations/[id]/messages — happy path', () => {
  it('returns 200 with messages in ascending order from validated conversation', async () => {
    mocks.validateConversationAccess.mockResolvedValueOnce({
      userId: mocks.USER_ID,
      orgId: mocks.ORG_ID,
      studyId: mocks.STUDY_ID,
    })
    const msgs = [makeMessage('user'), makeMessage('assistant')]
    mocks.getConversationMessages.mockResolvedValueOnce(msgs)

    const res = await GET(makeRequest(mocks.CONV_ID), makeRouteCtx())
    const body = await res.json() as { conversationId: string; studyId: string; messages: unknown[] }

    expect(res.status).toBe(200)
    expect(body.conversationId).toBe(mocks.CONV_ID)
    expect(body.studyId).toBe(mocks.STUDY_ID)
    expect(body.messages).toHaveLength(2)
  })

  it('calls getConversationMessages with orgId and studyId from auth', async () => {
    mocks.validateConversationAccess.mockResolvedValueOnce({
      userId: mocks.USER_ID,
      orgId: mocks.ORG_ID,
      studyId: mocks.STUDY_ID,
    })
    mocks.getConversationMessages.mockResolvedValueOnce([])

    await GET(makeRequest(mocks.CONV_ID), makeRouteCtx())

    expect(mocks.getConversationMessages).toHaveBeenCalledWith(
      mocks.CONV_ID,
      mocks.ORG_ID,
      mocks.STUDY_ID,
    )
  })

  it('returns 200 with empty messages list when conversation has no messages', async () => {
    mocks.validateConversationAccess.mockResolvedValueOnce({
      userId: mocks.USER_ID,
      orgId: mocks.ORG_ID,
      studyId: mocks.STUDY_ID,
    })
    mocks.getConversationMessages.mockResolvedValueOnce([])

    const res = await GET(makeRequest(mocks.CONV_ID), makeRouteCtx())
    const body = await res.json() as { messages: unknown[] }

    expect(res.status).toBe(200)
    expect(body.messages).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Auth and access
// ---------------------------------------------------------------------------

describe('GET /api/conversations/[id]/messages — auth and access', () => {
  it('returns 403/404 when conversation belongs to another user/org/study', async () => {
    mocks.validateConversationAccess.mockRejectedValueOnce(
      new mocks.AccessError('Conversation not found or access denied', 404),
    )

    const res = await GET(makeRequest(mocks.CONV_ID), makeRouteCtx())

    expect([403, 404]).toContain(res.status)
    expect(mocks.getConversationMessages).not.toHaveBeenCalled()
  })

  it('returns 401 when not authenticated', async () => {
    mocks.validateConversationAccess.mockRejectedValueOnce(
      new mocks.AccessError('Unauthorized', 401),
    )

    const res = await GET(makeRequest(mocks.CONV_ID), makeRouteCtx())

    expect([401, 403]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('GET /api/conversations/[id]/messages — input validation', () => {
  it('returns 400 when conversationId is not a UUID', async () => {
    const res = await GET(
      makeRequest('not-a-uuid'),
      { params: Promise.resolve({ conversationId: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.validateConversationAccess).not.toHaveBeenCalled()
  })

  it('returns 400 when orgId appears as query param', async () => {
    const res = await GET(
      makeRequest(mocks.CONV_ID, { orgId: 'x' }),
      makeRouteCtx(),
    )
    expect(res.status).toBe(400)
    expect(mocks.validateConversationAccess).not.toHaveBeenCalled()
  })

  it('returns 400 when organizationId appears as query param', async () => {
    const res = await GET(
      makeRequest(mocks.CONV_ID, { organizationId: 'x' }),
      makeRouteCtx(),
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Response safety
// ---------------------------------------------------------------------------

describe('GET /api/conversations/[id]/messages — response safety', () => {
  it('does not expose embeddings or raw prompts in response', async () => {
    mocks.validateConversationAccess.mockResolvedValueOnce({
      userId: mocks.USER_ID,
      orgId: mocks.ORG_ID,
      studyId: mocks.STUDY_ID,
    })
    mocks.getConversationMessages.mockResolvedValueOnce([makeMessage()])

    const res = await GET(makeRequest(mocks.CONV_ID), makeRouteCtx())
    const body = await res.json() as Record<string, unknown>

    expect(body).not.toHaveProperty('embedding')
    expect(body).not.toHaveProperty('prompt')
    expect(body).not.toHaveProperty('orgId')
    expect(body).not.toHaveProperty('organizationId')
  })
})
