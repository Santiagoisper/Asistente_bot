import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePatientProfile, type PatientProfile } from '@ichtys/clinical'

/**
 * Hallazgo de revisión del #178: la ruta le pasaba al servicio el identificador de la evolución
 * tal como llegó en el pedido. La base lo compara como `uuid` y no distingue mayúsculas; el
 * perfil guarda texto y sí las distingue. Con el identificador en mayúsculas la evolución se
 * encontraba, y después no coincidía con el origen de ningún laboratorio: respondía 200 sin
 * retirar lo que debía, y aceptaba «no hay nada» habiendo un laboratorio de ese origen.
 *
 * Acá corren la ruta, el servicio y la función que decide qué sale, los tres de verdad. Solo la
 * escritura en la base está simulada, con un perfil en memoria. Los identificadores llevan
 * letras a propósito: con dígitos solos, mayúsculas y minúsculas son el mismo texto y la prueba
 * no ve nada.
 */
const mocks = vi.hoisted(() => ({
  validateSubjectAccess: vi.fn(),
  findEvolution: vi.fn(),
  rateLimit: vi.fn(),
  store: { profile: null as unknown, writes: 0, audits: [] as Array<{ metadata?: Record<string, unknown> }> },
}))

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: () => new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('../../../../../../../../../../lib/security/clinical-rate-limit', () => ({ clinicalRateLimit: mocks.rateLimit }))
vi.mock('../../../../../../../../../../lib/subjects/evolution-reader', () => ({ findSubjectEvolution: mocks.findEvolution }))
vi.mock('../../../../../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))
// Lo único simulado del perfil: leerlo y escribirlo. Si el cambio tira, no se escribe ni se registra.
vi.mock('../../../../../../../../../../lib/subjects/patient-profile-service', () => ({
  ProfileUnreadableError: class extends Error {},
  ProfileInvalidError: class extends Error {},
  updatePatientProfile: async (
    _scope: unknown,
    mutate: (current: unknown) => unknown,
    audit: (next: unknown) => { metadata?: Record<string, unknown> },
  ) => {
    const next = await mutate(mocks.store.profile)
    mocks.store.audits.push(audit(next))
    mocks.store.profile = next
    mocks.store.writes += 1
    return next
  },
}))

import { POST } from '../route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
/** Como lo devuelve la base: en minúsculas. */
const VOIDED = 'a3b4c5d6-e7f8-4a1b-9c2d-e3f4a5b6c7d8'
/** La misma evolución, escrita como puede llegar en un pedido armado a mano. */
const VOIDED_AS_SENT = VOIDED.toUpperCase()
const OTHER = 'b1c2d3e4-f5a6-4b7c-8d9e-f0a1b2c3d4e5'

const params = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT }) }
const request = (body: unknown) => new Request('http://test/retire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const fromEvolution = (name: string, value: number, evolutionId: string) => ({ name, value, source: { kind: 'evolution' as const, evolutionId } })
const stored = () => mocks.store.profile as PatientProfile

beforeEach(() => {
  vi.resetAllMocks()
  mocks.validateSubjectAccess.mockResolvedValue({ orgId: 'org-1', userId: 'user_md', study: { id: STUDY }, subject: { id: SUBJECT, subjectCode: 'GZBO-001' } })
  mocks.rateLimit.mockResolvedValue(null)
  mocks.findEvolution.mockResolvedValue({ id: VOIDED, authorUserId: 'user_x', voided: { reason: 'wrong_subject', declaredBy: 'user_x', declaredAt: new Date() } })
  mocks.store.writes = 0
  mocks.store.audits.length = 0
  mocks.store.profile = parsePatientProfile({
    version: 1,
    labs: [fromEvolution('Ferritina', 480, VOIDED), fromEvolution('Glucosa', 110, OTHER)],
    medications: [],
    conditions: [],
    lastEvolutionId: VOIDED,
  })
})

describe('POST — retirar del perfil con el identificador de la evolución en mayúsculas', () => {
  it('el laboratorio de ese origen sale, y lo que queda guardado lleva el identificador de la base', async () => {
    const res = await POST(request({ evolutionId: VOIDED_AS_SENT, confirmedSubjectCode: 'GZBO-001' }), params)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.retired).toEqual({ labs: 1, medications: 0, conditions: 0, age: false, bloodPressure: false })
    // El laboratorio de la otra evolución sigue; el de la anulada, no.
    expect(stored().labs.map((lab) => lab.name)).toEqual(['Glucosa'])
    expect(stored().retiredFacts).toHaveLength(1)
    expect(stored().retiredFacts?.[0]).toMatchObject({ evolutionId: VOIDED, retiredBy: 'user_md', labs: [{ name: 'Ferritina', value: 480 }] })
    // La anulada deja de figurar como la última que escribió el perfil.
    expect(stored().lastEvolutionId).toBeUndefined()
    // Lo que apaga el aviso de la ficha y lo que queda en el registro: el mismo identificador.
    expect(body.profile.retiredFrom.map((entry: { evolutionId: string }) => entry.evolutionId)).toEqual([VOIDED])
    expect(mocks.store.audits).toHaveLength(1)
    expect(mocks.store.audits[0]?.metadata).toMatchObject({ source: 'voided_origin_retire', evolutionId: VOIDED, labs: 1 })
  })

  it('declarar «no hay nada» habiendo un laboratorio de ese origen: 409 `not_empty`, y el perfil no cambia', async () => {
    const before = structuredClone(stored())

    const res = await POST(request({ evolutionId: VOIDED_AS_SENT, confirmedSubjectCode: 'GZBO-001', nothingToRetire: true }), params)

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_empty' })
    expect(mocks.store.writes).toBe(0)
    expect(mocks.store.audits).toHaveLength(0)
    expect(stored()).toEqual(before)
  })
})
