import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Límite de pedidos de la extracción de laboratorio desde texto. */
const mocks = vi.hoisted(() => ({
  validateSubjectAccess: vi.fn(),
  proposeLabOcrReview: vi.fn(),
  clinicalRateLimit: vi.fn(async (): Promise<Response | null> => null),
}))

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: () => new Response('Forbidden', { status: 403 }),
}))
vi.mock('../../../../../../../../../lib/subjects/lab-review-service', () => ({
  proposeLabOcrReview: mocks.proposeLabOcrReview,
  LabReviewError: class LabReviewError extends Error {},
}))
vi.mock('../../../../../../../../../lib/security/clinical-rate-limit', () => ({ clinicalRateLimit: mocks.clinicalRateLimit }))

import { POST } from '../route'

const ctx = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111', subjectId: '22222222-2222-4222-8222-222222222222' }) }
const request = () =>
  new Request('https://os.example.test/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hemoglobina 13,5 g/dL' }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateSubjectAccess.mockResolvedValue({ orgId: 'org-1', userId: 'user_1', study: { id: 's1' }, subject: { id: 'u1', subjectCode: 'SUJ-1' } })
  mocks.proposeLabOcrReview.mockResolvedValue({ profile: { pendingLabReview: null, labs: [] } })
})

describe('POST labs/extract — límite de pedidos', () => {
  it('cuenta el pedido contra la persona y su organización', async () => {
    const res = await POST(request(), ctx)
    expect(res.status).toBe(200)
    expect(mocks.clinicalRateLimit).toHaveBeenCalledWith('lab_extract', expect.objectContaining({ orgId: 'org-1', userId: 'user_1' }))
  })

  it('con el cupo agotado no se lee el texto ni se propone nada', async () => {
    mocks.clinicalRateLimit.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '30' } }))
    const req = request()
    const res = await POST(req, ctx)
    expect(res.status).toBe(429)
    expect(req.bodyUsed).toBe(false)
    expect(mocks.proposeLabOcrReview).not.toHaveBeenCalled()
  })

  it('sin acceso no se cuenta nada', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new Error('sin acceso'))
    expect((await POST(request(), ctx)).status).toBe(403)
    expect(mocks.clinicalRateLimit).not.toHaveBeenCalled()
  })
})
