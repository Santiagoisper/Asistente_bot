import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateDocumentVersionAccess: vi.fn(),
  handleApiError: vi.fn<(err: unknown) => Response>((err: unknown) => {
    if (err instanceof Error && err.name === 'AccessError' && 'status' in err) {
      const status = (err as { status: number }).status
      if (status === 401 || status === 403 || status === 404) {
        const body = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not Found'
        return new Response(body, { status })
      }
    }
    return new Response('Internal Server Error', { status: 500 })
  }),
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

vi.mock('@ichtys/auth', async () => {
  const roles = await vi.importActual<typeof import('@ichtys/auth/roles')>('@ichtys/auth/roles')
  return {
    validateDocumentVersionAccess: mocks.validateDocumentVersionAccess,
    handleApiError: mocks.handleApiError,
    canManageDocuments: roles.canManageDocuments,
    AccessError: class AccessError extends Error {
      readonly status: 401 | 403 | 404
      constructor(message: string, status: 401 | 403 | 404) {
        super(message)
        this.name = 'AccessError'
        this.status = status
      }
    },
  }
})

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
    role: 'site_coordinator',
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
      onRedisUnavailable: 'memory',
    })
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it('devuelve 202 y encola la ingesta dentro del tope', async () => {
    const res = await POST(ingestionRequest())

    expect(res.status).toBe(202)
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it.each(['read_only_monitor', 'principal_investigator'])(
    'rechaza a %s antes de encolar la ingesta',
    async (role) => {
      mocks.validateDocumentVersionAccess.mockResolvedValue({
        userId: USER_ID,
        orgId: crypto.randomUUID(),
        studyId: crypto.randomUUID(),
        role,
        document: { id: crypto.randomUUID() },
        documentVersion: { id: DOC_VERSION_ID },
      })

      const res = await POST(ingestionRequest())

      expect(res.status).toBe(403)
      expect(await res.text()).toBe('Forbidden')
      expect(mocks.after).not.toHaveBeenCalled()
      expect(mocks.enforceSlidingWindowRateLimit).not.toHaveBeenCalled()
    },
  )
})

const PROVIDER_SENTINEL = 'sk-ant-provider-raw-ficticio-NO-LOG'

function flattenLogValue(value: unknown): string {
  if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ''}`
  if (Array.isArray(value)) return value.map(flattenLogValue).join(' ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => args.map(flattenLogValue).join(' ')).join('\n')
}

describe('POST /api/ingestion/run — S8 mensaje crudo', () => {
  it('el fallo de la ingesta en background no registra el error crudo', async () => {
    let pending: Promise<unknown> = Promise.resolve()
    mocks.after.mockImplementation((fn: () => Promise<void>) => {
      pending = Promise.resolve().then(fn)
    })
    mocks.runIngestion.mockRejectedValue(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const res = await POST(ingestionRequest())
      await pending
      const logged = loggedText(spy)

      expect(res.status).toBe(202)
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('ingestion_failed')
    } finally {
      spy.mockRestore()
      mocks.after.mockReset()
    }
  })
})
