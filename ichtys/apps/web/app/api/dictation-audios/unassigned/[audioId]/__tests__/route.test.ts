import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Escuchar una grabación sin sujeto (D24, punto 3). Sigue siendo dato clínico: la escucha
 * quien la grabó, si conserva el acceso al estudio; cada escucha queda registrada antes de
 * entregar; una vencida no se entrega.
 */
const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  return {
    AccessError: MockAccessError,
    orgContext: vi.fn(),
    studyAccess: vi.fn(),
    find: vi.fn(),
    loadBytes: vi.fn(),
    rateLimit: vi.fn(),
    audit: vi.fn(),
    order: [] as string[],
  }
})

vi.mock('@ichtys/auth', () => ({
  AccessError: mocks.AccessError,
  validatePhiStudyAccess: mocks.studyAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('../../../../../../lib/access/org-context', () => ({ resolveOrgAccessContext: mocks.orgContext }))
vi.mock('../../../../../../lib/dictation/audio-store', () => ({ findUnassignedAudio: mocks.find, loadUnassignedAudioBytes: mocks.loadBytes }))
vi.mock('../../../../../../lib/security/clinical-rate-limit', () => ({ clinicalRateLimit: mocks.rateLimit }))
vi.mock('../../../../../../lib/chat/persistence', () => ({ writeAuditLog: mocks.audit }))
vi.mock('../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))

import { GET } from '../route'

const ID = '44444444-4444-4444-8444-444444444444'
const NOW = new Date('2026-11-14T22:00:00Z')
const params = (audioId = ID) => ({ params: Promise.resolve({ audioId }) })
const request = () => new Request('http://test/audio')
const meta = (over: Record<string, unknown> = {}) => ({
  id: ID,
  studyId: 'study-1',
  evolutionId: 'evo-1',
  take: 2,
  mime: 'audio/webm',
  createdBy: 'user_me',
  expiresAt: new Date('2026-12-10T12:00:00Z'),
  purgedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.order.length = 0
  mocks.orgContext.mockReset().mockResolvedValue({ orgId: 'org-1', userId: 'user_me' })
  mocks.find.mockReset().mockResolvedValue(meta())
  mocks.studyAccess.mockReset().mockResolvedValue({ study: { id: 'study-1' } })
  mocks.rateLimit.mockReset().mockResolvedValue(null)
  mocks.loadBytes.mockReset().mockImplementation(async () => {
    mocks.order.push('descifrar')
    return new Uint8Array([1, 2, 3])
  })
  mocks.audit.mockReset().mockImplementation(async () => {
    mocks.order.push('registrar')
  })
})

describe('GET — escuchar una grabación sin sujeto', () => {
  it('quien la grabó la escucha: se registra antes de entregar, sin contenido en el registro', async () => {
    const res = await GET(request(), params())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/webm')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(mocks.find).toHaveBeenCalledWith({ orgId: 'org-1', id: ID })
    expect(mocks.audit).toHaveBeenCalledWith({
      action: 'evolution.audio.listen',
      orgId: 'org-1',
      studyId: 'study-1',
      userId: 'user_me',
      resourceType: 'unassigned_dictation_audio',
      resourceId: ID,
      metadata: { evolutionId: 'evo-1', take: 2, unassigned: true },
    })
    expect(mocks.order).toEqual(['descifrar', 'registrar'])
  })

  it('si no se puede registrar la escucha, no se entrega', async () => {
    mocks.audit.mockRejectedValue(new Error('registro caído'))
    const res = await GET(request(), params())
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('\u0001')
  })

  it('la de otra persona responde como si no existiera: sin comprobar el estudio, sin descifrar y sin registrar', async () => {
    mocks.find.mockResolvedValue(meta({ createdBy: 'user_otro' }))
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(mocks.studyAccess).not.toHaveBeenCalled()
    expect(mocks.loadBytes).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('una que no existe: 404', async () => {
    mocks.find.mockResolvedValue(null)
    expect((await GET(request(), params())).status).toBe(404)
    expect(mocks.loadBytes).not.toHaveBeenCalled()
  })

  it('un identificador que no puede existir: 404 sin consultar', async () => {
    expect((await GET(request(), params('no-es-un-id'))).status).toBe(404)
    expect(mocks.find).not.toHaveBeenCalled()
  })

  it('quien perdió el acceso al estudio no la escucha, aunque la haya grabado', async () => {
    mocks.studyAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    const res = await GET(request(), params())
    expect(res.status).toBe(403)
    expect(mocks.studyAccess).toHaveBeenCalledWith('study-1')
    expect(mocks.loadBytes).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('una vencida no se entrega aunque la limpieza todavía no haya pasado: 410, sin descifrar', async () => {
    mocks.find.mockResolvedValue(meta({ expiresAt: new Date('2026-11-14T21:59:59Z') }))
    const res = await GET(request(), params())
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'audio_expired' })
    expect(mocks.loadBytes).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('una ya borrada: 410', async () => {
    mocks.find.mockResolvedValue(meta({ purgedAt: new Date('2026-11-12T00:00:00Z') }))
    expect((await GET(request(), params())).status).toBe(410)
  })

  it('si el contenido ya no está al ir a buscarlo: 410, y no se registra una escucha que no hubo', async () => {
    mocks.loadBytes.mockResolvedValue(null)
    const res = await GET(request(), params())
    expect(res.status).toBe(410)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('el límite de pedidos corta antes de descifrar y de registrar, y cuenta contra la persona y el estudio', async () => {
    mocks.rateLimit.mockResolvedValue(new Response('Too Many Requests', { status: 429 }))
    const res = await GET(request(), params())
    expect(res.status).toBe(429)
    expect(mocks.rateLimit.mock.calls[0]![0]).toBe('audio_listen')
    expect(mocks.rateLimit.mock.calls[0]![1]).toMatchObject({ orgId: 'org-1', userId: 'user_me', studyId: 'study-1' })
    expect(mocks.loadBytes).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('sin sesión: 401, y no se consulta nada', async () => {
    mocks.orgContext.mockRejectedValue(new mocks.AccessError('Unauthorized', 401))
    expect((await GET(request(), params())).status).toBe(401)
    expect(mocks.find).not.toHaveBeenCalled()
  })
})
