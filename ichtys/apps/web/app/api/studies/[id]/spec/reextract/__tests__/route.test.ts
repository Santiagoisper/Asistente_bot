import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateStudyAccess: vi.fn(),
  handleApiError: vi
    .fn<(err: unknown) => Response>()
    .mockReturnValue(new Response('Internal Server Error', { status: 500 })),
  enforceSlidingWindowRateLimit: vi.fn(),
  getSpecReextractRateLimitConfig: vi.fn().mockReturnValue({ limit: 3, windowSeconds: 60 }),
  rateLimitResponse: vi.fn(
    (retryAfterSeconds: number) =>
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      }),
  ),
  getQuotaStatus: vi.fn(),
  getOrgLlmApiKeys: vi.fn(),
  getOrgLlmKeySource: vi.fn(),
  getLatestSpecAttempt: vi.fn(),
  getProtocolDocumentVersionId: vi.fn(),
  reextractStudySpec: vi.fn(),
}))

vi.mock('@ichtys/auth', () => ({
  validateStudyAccess: mocks.validateStudyAccess,
  handleApiError: mocks.handleApiError,
}))

vi.mock('@ichtys/db', () => ({
  getQuotaStatus: mocks.getQuotaStatus,
  getOrgLlmApiKeys: mocks.getOrgLlmApiKeys,
  getOrgLlmKeySource: mocks.getOrgLlmKeySource,
  canUsePlatformKey: (status: { state: string }) => status.state !== 'exceeded',
}))

vi.mock('@ichtys/ingestion', () => ({
  getLatestSpecAttempt: mocks.getLatestSpecAttempt,
  isMeaningfulSpec: () => true,
  specRichness: () => 20,
  studySpecSchema: { safeParse: () => ({ success: false }) },
}))

vi.mock('@ichtys/ingestion/reextract-spec', () => ({
  getProtocolDocumentVersionId: mocks.getProtocolDocumentVersionId,
  reextractStudySpec: mocks.reextractStudySpec,
}))

vi.mock('../../../../../../../lib/security/rate-limit', () => ({
  enforceSlidingWindowRateLimit: mocks.enforceSlidingWindowRateLimit,
  getSpecReextractRateLimitConfig: mocks.getSpecReextractRateLimitConfig,
  rateLimitResponse: mocks.rateLimitResponse,
}))

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STUDY_ID = crypto.randomUUID()
const ORG_ID = crypto.randomUUID()
const USER_ID = crypto.randomUUID()

function reextractRequest(query = ''): Request {
  return new Request(`http://localhost/api/studies/${STUDY_ID}/spec/reextract${query}`, {
    method: 'POST',
  })
}

function callPost(query = ''): Promise<Response> {
  return POST(reextractRequest(query), { params: Promise.resolve({ id: STUDY_ID }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateStudyAccess.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID })
  mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: false })
  mocks.getSpecReextractRateLimitConfig.mockReturnValue({ limit: 3, windowSeconds: 60 })
  mocks.getQuotaStatus.mockResolvedValue({ state: 'ok' })
  mocks.getOrgLlmApiKeys.mockResolvedValue({})
  mocks.getOrgLlmKeySource.mockReturnValue('platform')
  mocks.getLatestSpecAttempt.mockResolvedValue(null)
  mocks.getProtocolDocumentVersionId.mockResolvedValue('dv-1')
  mocks.reextractStudySpec.mockResolvedValue({
    specId: 'spec-1',
    version: 7,
    richness: 20,
    warnings: [],
  })
})

// ---------------------------------------------------------------------------
// Rate limit (tope de gasto)
// ---------------------------------------------------------------------------

describe('POST /api/studies/[id]/spec/reextract — rate limit', () => {
  it('devuelve 429 y no llama al modelo cuando se supera el tope', async () => {
    mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: true, retryAfterSeconds: 42 })

    const res = await callPost('?force=1')

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(mocks.reextractStudySpec).not.toHaveBeenCalled()
  })

  it('aplica el tope por usuario+estudio', async () => {
    await callPost()

    expect(mocks.enforceSlidingWindowRateLimit).toHaveBeenCalledWith({
      key: `spec-reextract:${USER_ID}:${STUDY_ID}`,
      limit: 3,
      windowSeconds: 60,
    })
  })
})

// ---------------------------------------------------------------------------
// Cupo (fail closed)
// ---------------------------------------------------------------------------

describe('POST /api/studies/[id]/spec/reextract — cupo agotado', () => {
  it('devuelve 402 sin llamar al modelo si la cuota está agotada y se usaría la clave de plataforma', async () => {
    mocks.getQuotaStatus.mockResolvedValue({ state: 'exceeded' })

    const res = await callPost('?force=1')
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(402)
    expect(body.error).toBe('quota_exceeded')
    expect(mocks.reextractStudySpec).not.toHaveBeenCalled()
  })

  it('permite la extracción con clave propia de la organización aunque la cuota esté agotada', async () => {
    mocks.getQuotaStatus.mockResolvedValue({ state: 'exceeded' })
    mocks.getOrgLlmApiKeys.mockResolvedValue({ anthropic: 'sk-ant-org-propia' })
    mocks.getOrgLlmKeySource.mockReturnValue('org')

    const res = await callPost()

    expect(res.status).toBe(200)
    expect(mocks.reextractStudySpec).toHaveBeenCalledTimes(1)
  })

  it('falla cerrado (402) si el lookup de cupo revienta', async () => {
    mocks.getQuotaStatus.mockRejectedValue(new Error('db caída'))

    const res = await callPost()

    expect(res.status).toBe(402)
    expect(mocks.reextractStudySpec).not.toHaveBeenCalled()
  })

  it('no bloquea si el cupo está ok', async () => {
    const res = await callPost()
    const body = (await res.json()) as { status: string; version: number }

    expect(res.status).toBe(200)
    expect(body.status).toBe('completed')
    expect(body.version).toBe(7)
    expect(mocks.reextractStudySpec).toHaveBeenCalledWith({
      orgId: ORG_ID,
      studyId: STUDY_ID,
      documentVersionId: 'dv-1',
      userId: USER_ID,
    })
  })
})
