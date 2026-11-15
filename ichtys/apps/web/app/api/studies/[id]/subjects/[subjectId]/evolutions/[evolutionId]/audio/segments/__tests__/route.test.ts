/**
 * Los tramos de lo dictado (docs/decisions/enlace-frase-audio.md): quién los guarda, qué se
 * rechaza entero, quién los lee y qué queda en el registro. El texto de un tramo nunca va al
 * registro.
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
    lockEvolution: vi.fn(),
    findAudioForSegments: vi.fn(),
    storeAudioSegments: vi.fn(),
    loadAudioSegments: vi.fn(),
    writeAuditLog: vi.fn(),
    rateLimit: vi.fn(),
    audits: [] as Array<Record<string, unknown>>,
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('../../../../../../../../../../../lib/audit/audited-write', () => ({
  auditedWrite: async <T,>(write: (tx: unknown) => Promise<T>, audit: (result: T) => Record<string, unknown>) => {
    const result = await write({})
    mocks.audits.push(audit(result))
    return result
  },
}))
vi.mock('../../../../../../../../../../../lib/chat/persistence', () => ({ writeAuditLog: mocks.writeAuditLog }))
vi.mock('../../../../../../../../../../../lib/security/clinical-rate-limit', () => ({ clinicalRateLimit: mocks.rateLimit }))
vi.mock('../../../../../../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))
vi.mock('../../../../../../../../../../../lib/subjects/evolution-reader', () => ({ findSubjectEvolution: mocks.findEvolution, lockSubjectEvolution: mocks.lockEvolution }))
vi.mock('../../../../../../../../../../../lib/dictation/audio-store', () => ({
  findAudioForSegments: mocks.findAudioForSegments,
  storeAudioSegments: mocks.storeAudioSegments,
  loadAudioSegments: mocks.loadAudioSegments,
}))

import { GET, PUT } from '../route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const EVOLUTION = '33333333-3333-4333-8333-333333333333'
const params = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION }) }
const context = { userId: 'user_author', orgId: 'org-1', study: { id: STUDY }, subject: { id: SUBJECT } }
const SECRET = 'Paciente refiere dolor precordial'
const segments = [
  { startMs: 1000, endMs: 2500, text: SECRET },
  { startMs: 3000, endMs: 4000, text: 'Presión 132 84' },
]

function put(body: unknown = { segments }, query = '?take=1', headers: Record<string, string> = {}): Request {
  return new Request(`http://test/segments${query}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const get = (query = '?take=1') => new Request(`http://test/segments${query}`)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.audits.length = 0
  mocks.validateSubjectAccess.mockResolvedValue(context)
  mocks.rateLimit.mockResolvedValue(null)
  mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_author' })
  mocks.lockEvolution.mockResolvedValue(true)
  mocks.findAudioForSegments.mockResolvedValue({ state: 'ok', id: 'audio-1', durationSec: 5, createdBy: 'user_author', hasSegments: false })
  mocks.storeAudioSegments.mockResolvedValue(true)
  mocks.loadAudioSegments.mockResolvedValue({ state: 'ok', id: 'audio-1', segments })
  mocks.writeAuditLog.mockResolvedValue(undefined)
})

describe('PUT — guardar los tramos de una toma', () => {
  it('pide autoría clínica sobre el sujeto de la URL', async () => {
    await PUT(put(), params)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY, { require: 'clinical.author' })
  })

  it('guarda lo comprobado y registra cuántos, sin el texto', async () => {
    const res = await PUT(put({ segments: segments.map((s) => ({ ...s, extra: 1 })) }), params)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ count: 2 })
    expect(mocks.storeAudioSegments.mock.calls[0]![1]).toEqual({ orgId: 'org-1', audioId: 'audio-1', segments })
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({ action: 'evolution.audio.segments.store', orgId: 'org-1', studyId: STUDY, userId: 'user_author', resourceType: 'dictation_audio', resourceId: 'audio-1', metadata: { evolutionId: EVOLUTION, take: 1, count: 2, stored: true } })
    expect(JSON.stringify(mocks.audits)).not.toContain('dolor')
  })

  it('sin acceso no se lee nada', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('no', 404))
    expect((await PUT(put(), params)).status).toBe(404)
    expect(mocks.findEvolution).not.toHaveBeenCalled()
    expect(mocks.storeAudioSegments).not.toHaveBeenCalled()
  })

  it('frenado por el límite de pedidos, no sigue', async () => {
    mocks.rateLimit.mockResolvedValue(new Response('slow', { status: 429 }))
    expect((await PUT(put(), params)).status).toBe(429)
    expect(mocks.findEvolution).not.toHaveBeenCalled()
  })

  it('solo quien escribió la evolución: a la de otra persona, 403 y nada guardado', async () => {
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other' })
    expect((await PUT(put(), params)).status).toBe(403)
    expect(mocks.storeAudioSegments).not.toHaveBeenCalled()
    expect(mocks.audits).toHaveLength(0)
  })

  it('una grabación que cargó otra persona tampoco', async () => {
    mocks.findAudioForSegments.mockResolvedValue({ state: 'ok', id: 'audio-1', durationSec: 5, createdBy: 'user_other', hasSegments: false })
    expect((await PUT(put(), params)).status).toBe(403)
    expect(mocks.storeAudioSegments).not.toHaveBeenCalled()
  })

  it('evolución anulada o inexistente: 404', async () => {
    mocks.findEvolution.mockResolvedValue(null)
    expect((await PUT(put(), params)).status).toBe(404)
    expect(mocks.findEvolution).toHaveBeenCalledWith(expect.objectContaining({ evolutionId: EVOLUTION }), 'current')
  })

  it.each([
    ['missing', 404],
    ['expired', 410],
    ['withdrawn', 410],
  ])('grabación %s: %i y nada guardado', async (state, status) => {
    mocks.findAudioForSegments.mockResolvedValue({ state })
    expect((await PUT(put(), params)).status).toBe(status)
    expect(mocks.storeAudioSegments).not.toHaveBeenCalled()
  })

  it('una toma que ya tiene tramos no se pisa: 409', async () => {
    mocks.findAudioForSegments.mockResolvedValue({ state: 'ok', id: 'audio-1', durationSec: 5, createdBy: 'user_author', hasSegments: true })
    expect((await PUT(put(), params)).status).toBe(409)
    expect(mocks.storeAudioSegments).not.toHaveBeenCalled()
  })

  it('si alguien los guardó en el medio, 409 y el registro dice que no se guardó', async () => {
    mocks.storeAudioSegments.mockResolvedValue(false)
    expect((await PUT(put(), params)).status).toBe(409)
    expect(mocks.audits[0]).toMatchObject({ metadata: { stored: false } })
  })

  it('la evolución se anuló mientras llegaba el pedido: 404, nada guardado ni registrado', async () => {
    mocks.findEvolution.mockResolvedValueOnce({ id: EVOLUTION, authorUserId: 'user_author' }).mockResolvedValueOnce(null)
    expect((await PUT(put(), params)).status).toBe(404)
    expect(mocks.storeAudioSegments).not.toHaveBeenCalled()
    expect(mocks.audits).toHaveLength(0)
  })

  it('los tiempos se comprueban contra la duración de la grabación guardada, no contra lo que diga el pedido', async () => {
    const res = await PUT(put({ segments: [{ startMs: 0, endMs: 60_000, text: 'a' }], durationSec: 600 }), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_segments' })
    expect(mocks.storeAudioSegments).not.toHaveBeenCalled()
  })

  it.each([
    ['cuerpo que no es JSON', '{nope'],
    ['sin lista', {}],
    ['lista superpuesta', { segments: [segments[0], { startMs: 2000, endMs: 3000, text: 'b' }] }],
  ])('rechaza entero: %s', async (_name, body) => {
    expect((await PUT(put(body), params)).status).toBe(400)
    expect(mocks.storeAudioSegments).not.toHaveBeenCalled()
  })

  it('un cuerpo demasiado grande no se procesa', async () => {
    const res = await PUT(put({ segments: [{ startMs: 0, endMs: 1000, text: 'a'.repeat(700_000) }] }), params)
    expect(res.status).toBe(413)
    expect(mocks.findAudioForSegments).not.toHaveBeenCalled()
  })

  it('toma o evolución que no pueden existir: 400 y 404', async () => {
    expect((await PUT(put({ segments }, '?take=0'), params)).status).toBe(400)
    const bad = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, evolutionId: 'x' }) }
    expect((await PUT(put(), bad)).status).toBe(404)
  })
})

describe('GET — leer los tramos de una toma', () => {
  it('con acceso clínico al sujeto, sin pedir más: lo lee quien puede escuchar la grabación', async () => {
    const res = await GET(get('?take=2'), params)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ segments })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.loadAudioSegments).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION, take: 2 }))
  })

  it('queda registrado quién los leyó, sin el texto', async () => {
    await GET(get(), params)
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      action: 'evolution.audio.segments.read',
      orgId: 'org-1',
      studyId: STUDY,
      userId: 'user_author',
      resourceType: 'dictation_audio',
      resourceId: 'audio-1',
      metadata: { subjectId: SUBJECT, evolutionId: EVOLUTION, take: 1, count: 2 },
    })
  })

  it('si no se puede registrar, no se entrega', async () => {
    mocks.writeAuditLog.mockRejectedValue(new Error('audit down'))
    const res = await GET(get(), params)
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('dolor')
  })

  it.each([
    ['missing', 404],
    ['none', 404],
    ['expired', 410],
    ['withdrawn', 410],
  ])('%s: %i, sin registro de lectura', async (state, status) => {
    mocks.loadAudioSegments.mockResolvedValue({ state })
    expect((await GET(get(), params)).status).toBe(status)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('frenado por el límite de pedidos, no descifra', async () => {
    mocks.rateLimit.mockResolvedValue(new Response('slow', { status: 429 }))
    expect((await GET(get(), params)).status).toBe(429)
    expect(mocks.loadAudioSegments).not.toHaveBeenCalled()
  })

  it('sin acceso: lo que diga el acceso, y nada leído', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('no', 404))
    expect((await GET(get(), params)).status).toBe(404)
    expect(mocks.loadAudioSegments).not.toHaveBeenCalled()
  })
})
