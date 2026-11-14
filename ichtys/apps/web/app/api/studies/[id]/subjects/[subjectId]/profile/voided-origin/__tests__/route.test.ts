import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * De qué evoluciones anuladas de este sujeto se aceptó una propuesta para el perfil (D24).
 * La ruta devuelve solo identificadores: ni datos del perfil ni texto de la evolución.
 */
const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  return { AccessError: MockAccessError, validateSubjectAccess: vi.fn(), listVoided: vi.fn(), listAccepted: vi.fn() }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('../../../../../../../../../lib/subjects/voided-origin-store', () => ({
  listVoidedEvolutionIds: mocks.listVoided,
  listAcceptedProposalEvolutionIds: mocks.listAccepted,
}))

import { GET } from '../route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const VOIDED = '33333333-3333-4333-8333-333333333333'
const params = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT }) }
const scope = { orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT }
const get = () => GET(new Request('http://test/voided-origin'), params)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.validateSubjectAccess.mockResolvedValue({ orgId: 'org-1', userId: 'user_1', study: { id: STUDY }, subject: { id: SUBJECT, subjectCode: 'GZBO-001' } })
  mocks.listVoided.mockResolvedValue([VOIDED])
  mocks.listAccepted.mockResolvedValue([VOIDED])
})

describe('GET — evoluciones anuladas de las que se aceptó una propuesta', () => {
  it('devuelve los identificadores, acotado a la organización, el estudio y el sujeto de quien pide', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ acceptedFrom: [VOIDED] })
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY)
    expect(mocks.listVoided).toHaveBeenCalledWith(scope)
    expect(mocks.listAccepted).toHaveBeenCalledWith(scope, [VOIDED])
  })

  it('sin evoluciones anuladas no consulta el registro', async () => {
    mocks.listVoided.mockResolvedValue([])
    const res = await get()
    expect(await res.json()).toEqual({ acceptedFrom: [] })
    expect(mocks.listAccepted).not.toHaveBeenCalled()
  })

  it('una aceptación que el registro devuelva de una evolución no anulada no sale', async () => {
    mocks.listAccepted.mockResolvedValue([VOIDED, '44444444-4444-4444-8444-444444444444'])
    expect(await (await get()).json()).toEqual({ acceptedFrom: [VOIDED] })
  })

  it('sin acceso al sujeto no se consulta nada', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Not Found', 404))
    expect((await get()).status).toBe(404)
    expect(mocks.listVoided).not.toHaveBeenCalled()
    expect(mocks.listAccepted).not.toHaveBeenCalled()
  })

  it('si la consulta falla, no responde una lista vacía como si no hubiera nada', async () => {
    mocks.listAccepted.mockRejectedValue(new Error('sin conexión'))
    expect((await get()).status).toBe(500)
  })
})
