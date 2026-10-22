import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateDocumentVersionAccess: vi.fn(),
  handleApiError: vi
    .fn<(err: unknown) => Response>()
    .mockReturnValue(new Response('Internal Server Error', { status: 500 })),
  runIngestion: vi.fn(),
  after: vi.fn(),
  enforceSlidingWindowRateLimit: vi.fn(),
  getIngestionRateLimitConfig: vi.fn().mockReturnValue({ limit: 5, windowSeconds: 60 }),
  rateLimitResponse: vi.fn(
    (retryAfterSeconds: number) =>
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      }),
  ),
}))

vi.mock('next/server', () => ({ after: mocks.after }))

vi.mock('@ichtys/auth', () => ({
  validateDocumentVersionAccess: mocks.validateDocumentVersionAccess,
  handleApiError: mocks.handleApiError,
}))

vi.mock('@ichtys/ingestion', () => ({ runIngestion: mocks.runIngestion }))

vi.mock('../../../../../lib/security/rate-limit', () => ({
  enforceSlidingWindowRateLimit: mocks.enforceSlidingWindowRateLimit,
  getIngestionRateLimitConfig: mocks.getIngestionRateLimitConfig,
  rateLimitResponse: mocks.rateLimitResponse,
}))

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOC_VERSION_ID = crypto.randomUUID()
const USER_ID = crypto.randomUUID()

function ingestionRequest(): Request {
  return new Request('http://localhost/api/ingestion/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentVersionId: DOC_VERSION_ID }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateDocumentVersionAccess.mockResolvedValue({
    userId: USER_ID,
    orgId: crypto.randomUUID(),
    studyId: crypto.randomUUID(),
    document: { id: crypto.randomUUID() },
    documentVersion: { id: DOC_VERSION_ID },
  })
  mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: false })
  mocks.getIngestionRateLimitConfig.mockReturnValue({ limit: 5, windowSeconds: 60 })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/ingestion/run — rate limit', () => {
  it('devuelve 429 y no encola la ingesta cuando se supera el tope', async () => {
    mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: true, retryAfterSeconds: 30 })

    const res = await POST(ingestionRequest())

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('aplica el tope por usuario+documentVersion', async () => {
    await POST(ingestionRequest())

    expect(mocks.enforceSlidingWindowRateLimit).toHaveBeenCalledWith({
      key: `ingestion:${USER_ID}:${DOC_VERSION_ID}`,
      limit: 5,
      windowSeconds: 60,
    })
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it('devuelve 202 y encola la ingesta dentro del tope', async () => {
    const res = await POST(ingestionRequest())

    expect(res.status).toBe(202)
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })
})
