import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Retirar del perfil lo que entró desde una evolución anulada (D24, 4 bis). La ruta decide quién
 * puede, comprueba el sujeto y que la evolución esté anulada; qué sale lo decide la persona.
 */
const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  class MockSelectionError extends Error {
    constructor(readonly code: 'not_in_profile' | 'selection_required' | 'not_empty' = 'not_in_profile') {
      super(code)
    }
  }
  class MockUnreadableError extends Error {}
  class MockInvalidError extends Error {}
  return {
    AccessError: MockAccessError,
    RetireSelectionError: MockSelectionError,
    ProfileUnreadableError: MockUnreadableError,
    ProfileInvalidError: MockInvalidError,
    validateSubjectAccess: vi.fn(),
    findEvolution: vi.fn(),
    retire: vi.fn(),
    rateLimit: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('../../../../../../../../../../lib/security/clinical-rate-limit', () => ({ clinicalRateLimit: mocks.rateLimit }))
vi.mock('../../../../../../../../../../lib/subjects/evolution-reader', () => ({ findSubjectEvolution: mocks.findEvolution }))
vi.mock('../../../../../../../../../../lib/subjects/voided-origin-retire-service', () => ({ retireVoidedOriginFacts: mocks.retire }))
vi.mock('../../../../../../../../../../lib/subjects/voided-origin-retire', () => ({ RetireSelectionError: mocks.RetireSelectionError }))
vi.mock('../../../../../../../../../../lib/subjects/patient-profile-service', () => ({
  ProfileUnreadableError: mocks.ProfileUnreadableError,
  ProfileInvalidError: mocks.ProfileInvalidError,
}))
vi.mock('../../../../../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))

import { POST } from '../route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const EVOLUTION = '33333333-3333-4333-8333-333333333333'
const params = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT }) }
const context = { orgId: 'org-1', userId: 'user_md', study: { id: STUDY }, subject: { id: SUBJECT, subjectCode: 'GZBO-001' } }
const valid = { evolutionId: EVOLUTION, confirmedSubjectCode: 'GZBO-001', removeAge: true, medications: ['Atorvastatina'], conditions: [] }
const request = (body: unknown = valid) => new Request('http://test/retire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const retiredProfile = {
  version: 1,
  labs: [],
  medications: [],
  conditions: [],
  retiredFacts: [{ evolutionId: EVOLUTION, retiredAt: '2026-11-14T21:00:00.000Z', retiredBy: 'user_md', labs: [{ name: 'Ferritina', value: 480 }], medications: [{ name: 'Atorvastatina' }], conditions: [] }],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.validateSubjectAccess.mockResolvedValue(context)
  mocks.rateLimit.mockResolvedValue(null)
  mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_x', voided: { reason: 'wrong_subject', declaredBy: 'user_x', declaredAt: new Date() } })
  mocks.retire.mockResolvedValue({ profile: retiredProfile, removed: { labs: 1, medications: 1, conditions: 0, age: true, bloodPressure: false } })
})

describe('POST — retirar del perfil lo que entró desde una evolución anulada', () => {
  it('lo hace quien puede escribir el perfil, a su nombre, con lo que eligió', async () => {
    const res = await POST(request(), params)
    expect(res.status).toBe(200)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY, { require: 'clinical.author' })
    expect(mocks.findEvolution).toHaveBeenCalledWith({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION }, 'with-voided')
    expect(mocks.retire).toHaveBeenCalledWith({
      orgId: 'org-1',
      studyId: STUDY,
      subjectId: SUBJECT,
      evolutionId: EVOLUTION,
      userId: 'user_md',
      removeAge: true,
      removeBloodPressure: false,
      medications: ['Atorvastatina'],
      conditions: [],
      nothingToRetire: false,
    })
  })

  it('responde con cuánto salió y con el perfil sin lo retirado', async () => {
    const text = await (await POST(request(), params)).text()
    const body = JSON.parse(text)
    expect(body.retired).toEqual({ labs: 1, medications: 1, conditions: 0, age: true, bloodPressure: false })
    expect(body.profile.retiredFrom).toEqual([{ evolutionId: EVOLUTION, retiredAt: '2026-11-14T21:00:00.000Z' }])
    for (const leaked of ['retiredFacts', 'Ferritina', 'Atorvastatina']) expect(text).not.toContain(leaked)
  })

  it('sin la capacidad de escribir el perfil no se llega a nada', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    expect((await POST(request(), params)).status).toBe(403)
    expect(mocks.findEvolution).not.toHaveBeenCalled()
    expect(mocks.retire).not.toHaveBeenCalled()
  })

  it('el sujeto confirmado no es el de la ruta: 409 y no se retira nada', async () => {
    const res = await POST(request({ ...valid, confirmedSubjectCode: 'OTRO-999' }), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'subject_mismatch' })
    expect(mocks.retire).not.toHaveBeenCalled()
  })

  it('una evolución vigente no se puede usar para sacar datos del perfil: no es un editor general', async () => {
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_x', voided: null })
    const res = await POST(request(), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'evolution_not_voided' })
    expect(mocks.retire).not.toHaveBeenCalled()
  })

  it('una evolución que no es de este sujeto responde como si no existiera', async () => {
    mocks.findEvolution.mockResolvedValue(null)
    expect((await POST(request(), params)).status).toBe(404)
    expect(mocks.retire).not.toHaveBeenCalled()
  })

  it.each([
    ['sin la evolución', { confirmedSubjectCode: 'GZBO-001' }],
    ['sin el sujeto confirmado', { evolutionId: EVOLUTION }],
    ['con una clave de más', { ...valid, labs: ['Glucosa'] }],
    ['con un identificador que no lo es', { ...valid, evolutionId: 'x' }],
    ['con una lista desmedida', { ...valid, medications: Array.from({ length: 101 }, (_, i) => `m${i}`) }],
    ['con un nombre desmedido', { ...valid, conditions: ['x'.repeat(301)] }],
  ])('rechaza el pedido %s', async (_name, body) => {
    expect((await POST(request(body), params)).status).toBe(400)
    expect(mocks.retire).not.toHaveBeenCalled()
  })

  it('una elección que ya no está en el perfil: 409 con código propio, para que la pantalla recargue', async () => {
    mocks.retire.mockRejectedValue(new mocks.RetireSelectionError())
    const res = await POST(request(), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_in_profile' })
  })

  it('la declaración de «no hay nada que sacar» llega al servicio tal como la mandó la persona', async () => {
    await POST(request({ evolutionId: EVOLUTION, confirmedSubjectCode: 'GZBO-001', nothingToRetire: true }), params)
    expect(mocks.retire).toHaveBeenCalledWith(expect.objectContaining({ nothingToRetire: true, medications: [], conditions: [], removeAge: false }))
  })

  it('solo vale declararlo con `true`: un `false` o un texto no es una declaración', async () => {
    expect((await POST(request({ ...valid, nothingToRetire: false }), params)).status).toBe(400)
    expect((await POST(request({ ...valid, nothingToRetire: 'sí' }), params)).status).toBe(400)
    expect(mocks.retire).not.toHaveBeenCalled()
  })

  it('sin elegir nada y sin declararlo: 400 con código propio, y el aviso no se apaga', async () => {
    mocks.retire.mockRejectedValue(new mocks.RetireSelectionError('selection_required'))
    const res = await POST(request({ evolutionId: EVOLUTION, confirmedSubjectCode: 'GZBO-001' }), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'selection_required' })
  })

  it('declaró que no había nada y sí había: 409, para que la pantalla recargue', async () => {
    mocks.retire.mockRejectedValue(new mocks.RetireSelectionError('not_empty'))
    const res = await POST(request({ evolutionId: EVOLUTION, confirmedSubjectCode: 'GZBO-001', nothingToRetire: true }), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_empty' })
  })

  it('un perfil que no se puede leer: 422, no se retira a ciegas', async () => {
    mocks.retire.mockRejectedValue(new mocks.ProfileUnreadableError())
    const res = await POST(request(), params)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'profile_unreadable' })
  })

  it('con el cupo de pedidos agotado no se lee el cuerpo ni se retira', async () => {
    mocks.rateLimit.mockResolvedValue(new Response('Too Many Requests', { status: 429 }))
    expect((await POST(request(), params)).status).toBe(429)
    expect(mocks.retire).not.toHaveBeenCalled()
  })
})

/**
 * El perfil guarda identificadores como texto; la base los compara como `uuid`, sin distinguir
 * mayúsculas. Al servicio va el que devolvió la base, no el que llegó en el pedido (hallazgo de
 * revisión del #178). De punta a punta: `route.canonical-id.test.ts`.
 */
describe('POST — el identificador de la evolución, como lo devuelve la base', () => {
  const CANONICAL = 'a3b4c5d6-e7f8-4a1b-9c2d-e3f4a5b6c7d8'

  it('llega en mayúsculas: al servicio va el de la base', async () => {
    mocks.findEvolution.mockResolvedValue({ id: CANONICAL, authorUserId: 'user_x', voided: { reason: 'wrong_subject', declaredBy: 'user_x', declaredAt: new Date() } })

    const res = await POST(request({ ...valid, evolutionId: CANONICAL.toUpperCase() }), params)

    expect(res.status).toBe(200)
    expect(mocks.retire).toHaveBeenCalledTimes(1)
    expect((mocks.retire.mock.calls[0] as [{ evolutionId: string }])[0].evolutionId).toBe(CANONICAL)
  })
})
