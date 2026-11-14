import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Declarar que una evolución se registró en el sujeto equivocado
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, D24). La ruta decide quién puede y
 * comprueba el sujeto; anular y retirar lo hace el servicio, en una transacción.
 */
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
    voidEvolution: vi.fn(),
    txVoidStore: vi.fn(),
    retireProposal: vi.fn(),
    rateLimit: vi.fn(),
    transactions: 0,
    order: [] as string[],
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('@ichtys/db', () => ({
  db: {
    transaction: async <T,>(work: (tx: unknown) => Promise<T>) => {
      mocks.transactions += 1
      return work({ marca: 'transaccion' })
    },
  },
}))
vi.mock('../../../../../../../../../../lib/security/clinical-rate-limit', () => ({ clinicalRateLimit: mocks.rateLimit }))
vi.mock('../../../../../../../../../../lib/subjects/evolution-reader', () => ({ findSubjectEvolution: mocks.findEvolution }))
vi.mock('../../../../../../../../../../lib/subjects/evolution-void', () => ({ voidEvolution: mocks.voidEvolution }))
vi.mock('../../../../../../../../../../lib/subjects/evolution-void-store', () => ({ txVoidStore: mocks.txVoidStore }))
vi.mock('../../../../../../../../../../lib/subjects/patient-profile-service', () => ({
  retireProposalOfVoidedEvolution: mocks.retireProposal,
  ProfileUnreadableError: class ProfileUnreadableError extends Error {},
}))
vi.mock('../../../../../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))

import { POST } from '../route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const EVOLUTION = '33333333-3333-4333-8333-333333333333'
const params = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION }) }
// Por defecto: modo estricto, con la función de investigar y sin la de coordinar.
const context = {
  orgId: 'org-1',
  userId: 'user_author',
  study: { id: STUDY },
  subject: { id: SUBJECT, subjectCode: 'GZBO-001' },
  access: { mode: 'enforced', role: 'principal_investigator', functions: ['investigator'] as string[] },
}
const withAccess = (access: Partial<typeof context.access>) => ({ ...context, access: { ...context.access, ...access } })
const openContext = withAccess({ mode: 'open', functions: [] })

function request(body: unknown = { reason: 'wrong_subject', confirmedSubjectCode: 'GZBO-001' }): Request {
  return new Request('http://test/void', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transactions = 0
  mocks.order.length = 0
  // mockReset: una respuesta «una vez» que una prueba no llegó a consumir no pasa a la siguiente.
  mocks.validateSubjectAccess.mockReset().mockResolvedValue(context)
  mocks.rateLimit.mockResolvedValue(null)
  mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_author', voided: null })
  mocks.txVoidStore.mockReturnValue({ store: true })
  mocks.voidEvolution.mockImplementation(async () => {
    mocks.order.push('anular')
    return { status: 'voided', voidId: 'void-1', withdrawn: [{ sourceAudioId: 'a1', depositId: 'd1', take: 1 }] }
  })
  mocks.retireProposal.mockImplementation(async () => {
    mocks.order.push('retirar-propuesta')
    return true
  })
})

describe('POST — declarar que la evolución se registró en el sujeto equivocado', () => {
  it('quien la escribió la anula: una sola transacción, y la propuesta pendiente del perfil se retira en la misma', async () => {
    const res = await POST(request({ reason: 'wrong_subject', confirmedSubjectCode: 'GZBO-001', note: 'Era otro sujeto' }), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'voided', withdrawnAudios: 1, proposalRetired: true })
    expect(mocks.transactions).toBe(1)
    expect(mocks.order).toEqual(['anular', 'retirar-propuesta'])
    expect(mocks.txVoidStore).toHaveBeenCalledWith({ marca: 'transaccion' }, { orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION })
    const [, voidParams] = mocks.voidEvolution.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(voidParams).toMatchObject({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION, actorId: 'user_author', reason: 'wrong_subject', note: 'Era otro sujeto' })
    const [tx, proposal] = mocks.retireProposal.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(tx).toEqual({ marca: 'transaccion' })
    expect(proposal).toEqual({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: EVOLUTION, userId: 'user_author' })
  })

  it('el sujeto confirmado no es el de la ruta: 409 y no se anula nada (anular en el sujeto equivocado sería el mismo error dos veces)', async () => {
    const res = await POST(request({ reason: 'wrong_subject', confirmedSubjectCode: 'GZBO-002' }), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'subject_mismatch' })
    expect(mocks.transactions).toBe(0)
  })

  it('sin el sujeto confirmado no se acepta', async () => {
    expect((await POST(request({ reason: 'wrong_subject' }), params)).status).toBe(400)
    expect(mocks.transactions).toBe(0)
  })

  it.each([
    ['un motivo fuera de la lista', { reason: 'me_arrepenti', confirmedSubjectCode: 'GZBO-001' }],
    ['un campo de más', { reason: 'wrong_subject', confirmedSubjectCode: 'GZBO-001', evolutionId: 'otra' }],
    ['una nota demasiado larga', { reason: 'wrong_subject', confirmedSubjectCode: 'GZBO-001', note: 'x'.repeat(501) }],
  ])('rechaza %s', async (_name, body) => {
    expect((await POST(request(body), params)).status).toBe(400)
    expect(mocks.transactions).toBe(0)
  })

  it('otra persona sin coordinación del estudio no puede: 403, sin transacción', async () => {
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other', voided: null })

    const res = await POST(request(), params)

    expect(res.status).toBe(403)
    expect(mocks.transactions).toBe(0)
    expect(mocks.voidEvolution).not.toHaveBeenCalled()
  })

  it('quien no puede anular recibe 403 antes de cualquier respuesta que dependa de lo que mandó (primero quién es y qué puede)', async () => {
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other', voided: null })
    expect((await POST(request({ reason: 'wrong_subject', confirmedSubjectCode: 'OTRO-999' }), params)).status).toBe(403)
    expect((await POST(request({ reason: 'otro motivo' }), params)).status).toBe(403)
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other', voided: { reason: 'wrong_subject' } })
    expect((await POST(request(), params)).status).toBe(403)
    expect(mocks.transactions).toBe(0)
  })

  it('quien coordina el estudio puede anular la de otra persona', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(withAccess({ functions: ['study_coordinator'] }))
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other', voided: null })
    expect((await POST(request(), params)).status).toBe(200)
    expect(mocks.transactions).toBe(1)
  })

  it('la coordinación se decide con lo que ya se sabe de la persona: no se vuelve a pedir el acceso', async () => {
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other', voided: null })
    await POST(request(), params)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledTimes(1)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY)
  })

  it('quien la escribió no necesita la capacidad de coordinación', async () => {
    await POST(request(), params)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledTimes(1)
  })

  it('una evolución que no es de este sujeto responde como si no existiera', async () => {
    mocks.findEvolution.mockResolvedValue(null)
    expect((await POST(request(), params)).status).toBe(404)
    expect(mocks.transactions).toBe(0)
  })

  it('ya anulada: 409, y no se abre la transacción', async () => {
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_author', voided: { reason: 'wrong_subject', declaredBy: 'x', declaredAt: new Date() } })
    const res = await POST(request(), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_voided' })
    expect(mocks.transactions).toBe(0)
  })

  it('si otra persona la anuló en el mismo instante: 409, y la propuesta no se toca', async () => {
    mocks.voidEvolution.mockResolvedValue({ status: 'already_voided' })
    const res = await POST(request(), params)
    expect(res.status).toBe(409)
    expect(mocks.retireProposal).not.toHaveBeenCalled()
  })

  it('sin propuesta pendiente también anula, y lo dice', async () => {
    mocks.retireProposal.mockResolvedValue(false)
    expect(await (await POST(request(), params)).json()).toEqual({ status: 'voided', withdrawnAudios: 1, proposalRetired: false })
  })

  it('si retirar la propuesta falla, el error sube: la transacción deshace la anulación', async () => {
    mocks.retireProposal.mockRejectedValue(new Error('sin conexión'))
    expect((await POST(request(), params)).status).toBe(500)
  })

  it('con el cupo de pedidos agotado no se lee el cuerpo ni se anula', async () => {
    mocks.rateLimit.mockResolvedValue(new Response('limited', { status: 429 }))
    expect((await POST(request(), params)).status).toBe(429)
    expect(mocks.findEvolution).not.toHaveBeenCalled()
    expect(mocks.transactions).toBe(0)
  })

  it('sin acceso al sujeto no se cuenta ni se busca nada', async () => {
    mocks.validateSubjectAccess.mockReset().mockRejectedValue(new mocks.AccessError('Not Found', 404))
    expect((await POST(request(), params)).status).toBe(404)
    expect(mocks.rateLimit).not.toHaveBeenCalled()
  })

  it('un identificador de evolución que no puede existir responde 404', async () => {
    const bad = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, evolutionId: 'no-es-un-uuid' }) }
    expect((await POST(request(), bad)).status).toBe(404)
    expect(mocks.findEvolution).not.toHaveBeenCalled()
  })
})

describe('POST en modo abierto — coordina la coordinación del centro o más, no cualquiera con acceso clínico (D24, punto 1)', () => {
  const other = () => mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other', voided: null })

  it('un investigador que no la escribió no puede: 403, sin transacción', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(openContext)
    other()

    const res = await POST(request(), params)

    expect(res.status).toBe(403)
    expect(mocks.transactions).toBe(0)
    expect(mocks.voidEvolution).not.toHaveBeenCalled()
  })

  it('el 403 llega antes de cualquier respuesta que dependa de lo que mandó', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(openContext)
    other()
    expect((await POST(request({ reason: 'wrong_subject', confirmedSubjectCode: 'OTRO-999' }), params)).status).toBe(403)
    expect((await POST(request({ reason: 'otro motivo' }), params)).status).toBe(403)
    mocks.findEvolution.mockResolvedValue({ id: EVOLUTION, authorUserId: 'user_other', voided: { reason: 'wrong_subject' } })
    expect((await POST(request(), params)).status).toBe(403)
    expect(mocks.transactions).toBe(0)
  })

  it('la coordinación del centro, quien administra el estudio y quien administra la organización sí pueden', async () => {
    for (const role of ['site_coordinator', 'study_admin', 'org_admin']) {
      mocks.transactions = 0
      mocks.validateSubjectAccess.mockResolvedValue(withAccess({ mode: 'open', role, functions: [] }))
      other()
      expect((await POST(request(), params)).status, role).toBe(200)
      expect(mocks.transactions, role).toBe(1)
    }
  })

  it('las funciones cargadas no cuentan en modo abierto: un investigador con la función de coordinar sigue sin poder', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(withAccess({ mode: 'open', functions: ['study_coordinator'] }))
    other()
    expect((await POST(request(), params)).status).toBe(403)
  })

  it('quien la escribió puede, sea cual sea su rol', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(openContext)
    const res = await POST(request(), params)
    expect(res.status).toBe(200)
    expect(mocks.transactions).toBe(1)
  })

  it('un modo que no es exactamente el abierto se trata como estricto: ante la duda, se restringe', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(withAccess({ mode: 'otro', role: 'org_admin', functions: [] }))
    other()
    expect((await POST(request(), params)).status).toBe(403)
    expect(mocks.transactions).toBe(0)
  })
})

/**
 * El identificador de la ruta se compara como texto con la propuesta pendiente que guarda el
 * perfil; la base lo compara como `uuid`, sin distinguir mayúsculas. Con el identificador en
 * mayúsculas la evolución se anulaba (definitivo) y la propuesta que salió de ella quedaba
 * pendiente en el perfil del sujeto equivocado. Anular y retirar la propuesta usan el
 * identificador que devolvió la base (la clase del hallazgo de revisión del #178).
 */
describe('POST — el identificador de la evolución, como lo devuelve la base', () => {
  const CANONICAL = 'a3b4c5d6-e7f8-4a1b-9c2d-e3f4a5b6c7d8'
  const asSent = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, evolutionId: CANONICAL.toUpperCase() }) }

  it('llega en mayúsculas: se anula y se retira la propuesta de esa misma evolución', async () => {
    mocks.findEvolution.mockResolvedValue({ id: CANONICAL, authorUserId: 'user_author', voided: null })

    const res = await POST(request(), asSent)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'voided', withdrawnAudios: 1, proposalRetired: true })
    expect(mocks.txVoidStore).toHaveBeenCalledWith({ marca: 'transaccion' }, { orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: CANONICAL })
    const [, voidParams] = mocks.voidEvolution.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(voidParams.evolutionId).toBe(CANONICAL)
    const [, proposal] = mocks.retireProposal.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(proposal).toEqual({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: CANONICAL, userId: 'user_author' })
  })
})
