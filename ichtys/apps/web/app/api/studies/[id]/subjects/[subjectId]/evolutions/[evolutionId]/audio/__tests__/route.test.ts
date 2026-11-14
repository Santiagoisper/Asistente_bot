/**
 * Grabación de la evolución dictada (docs/decisions/consulta-dictada.md, D14).
 * Quién puede guardarla, qué se rechaza, qué queda en el registro y que una
 * grabación vencida no se entrega.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  return {
    AccessError: MockAccessError,
    validateSubjectAccess: vi.fn(),
    findEvolution: vi.fn(),
    storeDictationAudio: vi.fn(),
    loadDictationAudio: vi.fn(),
    purgeExpiredDictationAudios: vi.fn(),
    writeAuditLog: vi.fn(),
    insertAuditLog: vi.fn(),
    audits: [] as Array<Record<string, unknown>>,
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('../../../../../../../../../../lib/audit/audited-write', () => ({
  insertAuditLog: mocks.insertAuditLog,
  auditedWrite: async <T,>(write: (tx: unknown) => Promise<T>, audit: (result: T) => Record<string, unknown>) => {
    const result = await write({})
    mocks.audits.push(audit(result))
    return result
  },
}))
vi.mock('../../../../../../../../../../lib/chat/persistence', () => ({ writeAuditLog: mocks.writeAuditLog }))
vi.mock('../../../../../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))
vi.mock('../../../../../../../../../../lib/dictation/audio-store', () => ({
  DICTATION_AUDIO_MAX_BYTES: 4_000_000,
  baseMime: (value: string | null) => {
    const base = (value ?? '').split(';')[0]!.trim().toLowerCase()
    return ['audio/webm', 'audio/mp4', 'video/mp4'].includes(base) ? base : null
  },
  findEvolution: mocks.findEvolution,
  storeDictationAudio: mocks.storeDictationAudio,
  loadDictationAudio: mocks.loadDictationAudio,
  purgeExpiredDictationAudios: mocks.purgeExpiredDictationAudios,
}))

import { GET, POST } from '../route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const EVOLUTION = '33333333-3333-4333-8333-333333333333'
const params = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION }) }
const context = { userId: 'user_author', orgId: 'org-1', study: { id: STUDY }, subject: { id: SUBJECT } }

function upload(overrides: { headers?: Record<string, string>; body?: Uint8Array } = {}): Request {
  return new Request('http://test/audio', {
    method: 'POST',
    headers: { 'content-type': 'audio/webm;codecs=opus', 'x-duration-sec': '95', ...overrides.headers },
    body: (overrides.body ?? new Uint8Array([1, 2, 3, 4])) as BodyInit,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.audits.length = 0
  mocks.validateSubjectAccess.mockResolvedValue(context)
  mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_author' })
  mocks.purgeExpiredDictationAudios.mockResolvedValue([])
  mocks.storeDictationAudio.mockResolvedValue({ id: 'audio-1', sha256: 'abc', sizeBytes: 4, expiresAt: new Date('2026-12-12T00:00:00Z') })
  mocks.writeAuditLog.mockResolvedValue(undefined)
})

describe('POST — guardar la grabación', () => {
  it('pide autoría clínica sobre el sujeto de la URL', async () => {
    await POST(upload(), params)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY, { require: 'clinical.author' })
  })

  it('sin acceso no se lee el cuerpo ni se busca la evolución', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('no', 404))
    const res = await POST(upload(), params)
    expect(res.status).toBe(404)
    expect(mocks.findEvolution).not.toHaveBeenCalled()
    expect(mocks.storeDictationAudio).not.toHaveBeenCalled()
  })

  it('guarda, devuelve la huella y registra tamaño, duración y tipo, sin contenido', async () => {
    const res = await POST(upload(), params)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'audio-1', sha256: 'abc', expiresAt: '2026-12-12T00:00:00.000Z' })
    expect(mocks.storeDictationAudio.mock.calls[0]![1]).toMatchObject({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION, actorId: 'user_author', mime: 'audio/webm', durationSec: 95 })
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({
      action: 'evolution.audio.store',
      orgId: 'org-1',
      userId: 'user_author',
      resourceId: 'audio-1',
      metadata: { stored: true, mime: 'audio/webm', durationSec: 95, sizeBytes: 4, sha256: 'abc' },
    })
    expect(Object.keys(mocks.audits[0]!.metadata as object)).not.toContain('content')
  })

  it('la evolución de otra persona no recibe una grabación', async () => {
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other' })
    const res = await POST(upload(), params)
    expect(res.status).toBe(403)
    expect(mocks.storeDictationAudio).not.toHaveBeenCalled()
  })

  it('una evolución que no es de este sujeto responde como si no existiera', async () => {
    mocks.findEvolution.mockResolvedValue(null)
    expect((await POST(upload(), params)).status).toBe(404)
  })

  it.each([
    ['tipo que no es audio', { headers: { 'content-type': 'application/pdf' } }, 415],
    ['duración que no es un entero', { headers: { 'x-duration-sec': 'mucho' } }, 400],
    ['tamaño declarado sobre el tope', { headers: { 'content-length': '9000000' } }, 413],
    ['cuerpo vacío', { body: new Uint8Array() }, 400],
  ])('rechaza: %s', async (_name, overrides, status) => {
    const res = await POST(upload(overrides), params)
    expect(res.status).toBe(status)
    expect(mocks.storeDictationAudio).not.toHaveBeenCalled()
  })

  it('una segunda grabación para la misma evolución no pisa la primera', async () => {
    mocks.storeDictationAudio.mockResolvedValue(null)
    const res = await POST(upload(), params)
    expect(res.status).toBe(409)
    expect(mocks.audits[0]).toMatchObject({ metadata: { stored: false } })
  })

  it('sin número de toma guarda la primera; con X-Take guarda esa, y el registro la nombra (D22)', async () => {
    await POST(upload(), params)
    expect(mocks.storeDictationAudio.mock.calls[0]![1]).toMatchObject({ take: 1 })
    expect(mocks.audits[0]).toMatchObject({ metadata: { take: 1 } })

    await POST(upload({ headers: { 'x-take': '3' } }), params)
    expect(mocks.storeDictationAudio.mock.calls[1]![1]).toMatchObject({ take: 3 })
    expect(mocks.audits[1]).toMatchObject({ metadata: { take: 3, stored: true } })
  })

  it.each(['0', '6', 'dos', '1.5', ''])('un número de toma inválido (%j) se rechaza con 400 y no se guarda nada', async (take) => {
    const res = await POST(upload({ headers: { 'x-take': take } }), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_take', maxTakes: 5 })
    expect(mocks.storeDictationAudio).not.toHaveBeenCalled()
    expect(mocks.audits).toHaveLength(0)
  })

  it('lo vencido que se limpia de paso queda registrado como borrado del sistema', async () => {
    mocks.purgeExpiredDictationAudios.mockResolvedValue([{ id: 'old-1', organizationId: 'org-9', studyId: 'study-9' }])
    await POST(upload(), params)
    expect(mocks.insertAuditLog.mock.calls[0]![1]).toMatchObject({ action: 'evolution.audio.purge', orgId: 'org-9', userId: 'system:retention', resourceId: 'old-1' })
  })
})

describe('GET — escuchar la grabación', () => {
  it('registra quién la pidió antes de entregarla', async () => {
    mocks.loadDictationAudio.mockResolvedValue({ state: 'ok', id: 'audio-1', mime: 'audio/webm', bytes: new Uint8Array([9, 9]) })
    const res = await GET(new Request('http://test/audio'), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/webm')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'evolution.audio.listen', userId: 'user_author', resourceId: 'audio-1' }))
  })

  it('pide la toma de la URL (la primera si no dice cuál) y el registro la nombra (D22)', async () => {
    mocks.loadDictationAudio.mockResolvedValue({ state: 'ok', id: 'audio-2', mime: 'audio/webm', bytes: new Uint8Array([9]) })
    await GET(new Request('http://test/audio'), params)
    expect(mocks.loadDictationAudio.mock.calls[0]![0]).toMatchObject({ evolutionId: EVOLUTION, take: 1 })

    await GET(new Request('http://test/audio?take=2'), params)
    expect(mocks.loadDictationAudio.mock.calls[1]![0]).toMatchObject({ evolutionId: EVOLUTION, take: 2 })
    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({ resourceId: 'audio-2', metadata: expect.objectContaining({ take: 2 }) }))
  })

  it.each(['0', '6', 'dos'])('una toma inválida en la URL (%j) responde como si no existiera, sin buscar ni registrar', async (take) => {
    const res = await GET(new Request(`http://test/audio?take=${take}`), params)
    expect(res.status).toBe(404)
    expect(mocks.loadDictationAudio).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('si el registro falla, no se entrega', async () => {
    mocks.loadDictationAudio.mockResolvedValue({ state: 'ok', id: 'audio-1', mime: 'audio/webm', bytes: new Uint8Array([9]) })
    mocks.writeAuditLog.mockRejectedValue(new Error('db down'))
    expect((await GET(new Request('http://test/audio'), params)).status).toBe(500)
  })

  it('una grabación vencida responde 410 y no se registra una escucha', async () => {
    mocks.loadDictationAudio.mockResolvedValue({ state: 'expired' })
    expect((await GET(new Request('http://test/audio'), params)).status).toBe(410)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('sin grabación: 404', async () => {
    mocks.loadDictationAudio.mockResolvedValue({ state: 'missing' })
    expect((await GET(new Request('http://test/audio'), params)).status).toBe(404)
  })
})

const limit = vi.hoisted(() => ({ clinicalRateLimit: vi.fn(async (): Promise<Response | null> => null) }))
vi.mock('../../../../../../../../../../lib/security/clinical-rate-limit', () => limit)

describe('límite de pedidos — grabaciones', () => {
  it('guardar una grabación cuenta contra la persona y su organización', async () => {
    await POST(upload(), params)
    expect(limit.clinicalRateLimit).toHaveBeenCalledWith('audio_write', expect.objectContaining({ orgId: 'org-1', userId: 'user_author' }))
  })

  it('con el cupo agotado no se lee el cuerpo ni se guarda la grabación', async () => {
    limit.clinicalRateLimit.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '30' } }))
    const req = upload()
    const res = await POST(req, params)
    expect(res.status).toBe(429)
    expect(req.bodyUsed).toBe(false)
    expect(mocks.storeDictationAudio).not.toHaveBeenCalled()
  })

  it('escuchar lleva su propia cuenta, y con el cupo agotado no entrega ni registra la escucha', async () => {
    limit.clinicalRateLimit.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '30' } }))
    const res = await GET(new Request('http://test/audio'), params)
    expect(res.status).toBe(429)
    expect(limit.clinicalRateLimit).toHaveBeenCalledWith('audio_listen', expect.objectContaining({ orgId: 'org-1', userId: 'user_author' }))
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })
})
