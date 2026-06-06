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

  const ORG_ID = crypto.randomUUID()
  const STUDY_ID = crypto.randomUUID()
  const USER_ID = crypto.randomUUID()

  return {
    AccessError: MockAccessError,
    ORG_ID,
    STUDY_ID,
    USER_ID,
    validateStudyAccess: vi.fn(),
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockImplementation((err) =>
        err instanceof MockAccessError
          ? new Response('Forbidden', { status: err.status })
          : new Response('Internal Server Error', { status: 500 }),
      ),
    listConversationsForStudy: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateStudyAccess: mocks.validateStudyAccess,
  handleApiError: mocks.handleApiError,
  AccessError: mocks.AccessError,
}))

vi.mock('../../../../lib/chat/history', () => ({
  listConversationsForStudy: mocks.listConversationsForStudy,
}))

import { GET } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost/api/conversations'

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL(BASE_URL)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new Request(url.toString(), { method: 'GET' })
}

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: crypto.randomUUID(),
    studyId: mocks.STUDY_ID,
    title: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
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

describe('GET /api/conversations — happy path', () => {
  it('returns 200 with conversations for the authorized study', async () => {
    const conv = makeConversation()
    mocks.validateStudyAccess.mockResolvedValueOnce({
      userId: mocks.USER_ID,
      orgId: mocks.ORG_ID,
      study: { id: mocks.STUDY_ID },
    })
    mocks.listConversationsForStudy.mockResolvedValueOnce([conv])

    const res = await GET(makeRequest({ studyId: mocks.STUDY_ID }))
    const body = await res.json() as { conversations: unknown[] }

    expect(res.status).toBe(200)
    expect(body.conversations).toHaveLength(1)
    expect(body.conversations[0]).toMatchObject({ conversationId: conv.conversationId })
  })

  it('returns 200 with empty list when user has no conversations', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce({
      userId: mocks.USER_ID,
      orgId: mocks.ORG_ID,
      study: { id: mocks.STUDY_ID },
    })
    mocks.listConversationsForStudy.mockResolvedValueOnce([])

    const res = await GET(makeRequest({ studyId: mocks.STUDY_ID }))
    const body = await res.json() as { conversations: unknown[] }

    expect(res.status).toBe(200)
    expect(body.conversations).toEqual([])
  })

  it('passes orgId, studyId, userId from auth to the query helper (no in-memory filter)', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce({
      userId: mocks.USER_ID,
      orgId: mocks.ORG_ID,
      study: { id: mocks.STUDY_ID },
    })
    mocks.listConversationsForStudy.mockResolvedValueOnce([])

    await GET(makeRequest({ studyId: mocks.STUDY_ID }))

    expect(mocks.listConversationsForStudy).toHaveBeenCalledWith(
      mocks.ORG_ID,
      mocks.STUDY_ID,
      mocks.USER_ID,
    )
  })
})

// ---------------------------------------------------------------------------
// Auth and access
// ---------------------------------------------------------------------------

describe('GET /api/conversations — auth and access', () => {
  it('returns 401/403 when validateStudyAccess throws', async () => {
    mocks.validateStudyAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await GET(makeRequest({ studyId: mocks.STUDY_ID }))

    expect([401, 403, 404]).toContain(res.status)
    expect(mocks.listConversationsForStudy).not.toHaveBeenCalled()
  })

  it('returns 403/404 when study does not belong to active org', async () => {
    mocks.validateStudyAccess.mockRejectedValueOnce(
      new mocks.AccessError('Study not found or access denied', 404),
    )

    const res = await GET(makeRequest({ studyId: mocks.STUDY_ID }))

    expect([403, 404]).toContain(res.status)
    expect(mocks.listConversationsForStudy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('GET /api/conversations — input validation', () => {
  it('returns 400 when studyId is missing', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
    expect(mocks.validateStudyAccess).not.toHaveBeenCalled()
  })

  it('returns 400 when studyId is not a UUID', async () => {
    const res = await GET(makeRequest({ studyId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when orgId appears as query param', async () => {
    const res = await GET(makeRequest({ studyId: mocks.STUDY_ID, orgId: 'x' }))
    expect(res.status).toBe(400)
    expect(mocks.validateStudyAccess).not.toHaveBeenCalled()
  })

  it('returns 400 when organizationId appears as query param', async () => {
    const res = await GET(makeRequest({ studyId: mocks.STUDY_ID, organizationId: 'x' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when organization_id appears as query param', async () => {
    const res = await GET(makeRequest({ studyId: mocks.STUDY_ID, organization_id: 'x' }))
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

describe('GET /api/conversations — response shape', () => {
  it('does not expose orgId or userId in the response', async () => {
    mocks.validateStudyAccess.mockResolvedValueOnce({
      userId: mocks.USER_ID,
      orgId: mocks.ORG_ID,
      study: { id: mocks.STUDY_ID },
    })
    mocks.listConversationsForStudy.mockResolvedValueOnce([makeConversation()])

    const res = await GET(makeRequest({ studyId: mocks.STUDY_ID }))
    const body = await res.json() as Record<string, unknown>

    expect(body).not.toHaveProperty('orgId')
    expect(body).not.toHaveProperty('organizationId')
    expect(body).not.toHaveProperty('userId')
  })
})
