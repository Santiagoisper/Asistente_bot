import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  class MockProposalError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return { AccessError: MockAccessError, ProfileProposalError: MockProposalError, validateSubjectAccess: vi.fn(), confirmProfileProposal: vi.fn(), rejectProfileProposal: vi.fn() }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: (err: unknown) => (err instanceof mocks.AccessError ? new Response('x', { status: err.status }) : new Response('Internal Server Error', { status: 500 })),
}))
vi.mock('../../../../../../../../../lib/subjects/patient-profile-service', () => ({
  ProfileProposalError: mocks.ProfileProposalError,
  confirmProfileProposal: mocks.confirmProfileProposal,
  rejectProfileProposal: mocks.rejectProfileProposal,
}))
vi.mock('../../../../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))

import { POST as confirm } from '../[evolutionId]/confirm/route'
import { POST as reject } from '../[evolutionId]/reject/route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const EVO = '33333333-3333-4333-8333-333333333333'
const ctx = (evolutionId = EVO) => ({ params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, evolutionId }) })
const req = () => new Request('https://os.example.test/x', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateSubjectAccess.mockResolvedValue({ orgId: 'org-1', userId: 'user_md', study: { id: STUDY }, subject: { id: SUBJECT, subjectCode: 'E2E-001' } })
  mocks.confirmProfileProposal.mockResolvedValue({ version: 1, labs: [] })
  mocks.rejectProfileProposal.mockResolvedValue({ version: 1, labs: [] })
})

describe('propuestas para el perfil — aceptar y descartar', () => {
  it.each([
    ['aceptar', confirm, mocks.confirmProfileProposal],
    ['descartar', reject, mocks.rejectProfileProposal],
  ] as const)('%s: exige poder escribir evoluciones y actúa a nombre de quien lo hace', async (_name, handler, service) => {
    const res = await handler(req(), ctx())
    expect(res.status).toBe(200)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY, { require: 'clinical.author' })
    expect(service).toHaveBeenCalledWith({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, evolutionId: EVO, userId: 'user_md' })
    expect(await res.json()).toMatchObject({ subjectCode: 'E2E-001' })
  })

  it('sin acceso no se toca nada, y el rechazo es el del validador', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Not Found', 404))
    expect((await confirm(req(), ctx())).status).toBe(404)
    expect((await reject(req(), ctx())).status).toBe(404)
    expect(mocks.confirmProfileProposal).not.toHaveBeenCalled()
    expect(mocks.rejectProfileProposal).not.toHaveBeenCalled()
  })

  it('sin propuesta pendiente, o con un identificador que no lo es: 409 con código estable', async () => {
    mocks.confirmProfileProposal.mockRejectedValue(new mocks.ProfileProposalError('no_pending_proposal'))
    const missing = await confirm(req(), ctx())
    expect(missing.status).toBe(409)
    expect(await missing.json()).toEqual({ error: 'no_pending_proposal' })

    const malformed = await reject(req(), ctx('no-es-un-id'))
    expect(malformed.status).toBe(409)
    expect(mocks.rejectProfileProposal).not.toHaveBeenCalled()
  })
})
