import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La lista «Grabaciones sin sujeto» (docs/decisions/grabacion-en-sujeto-equivocado.md, D24,
 * punto 3). Por ahora cada persona ve las suyas: las que grabó, de estudios a los que sigue
 * teniendo acceso. Lo de «quien coordina» espera una decisión (en modo `open` no distingue a nadie).
 */
const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  return { AccessError: MockAccessError, orgContext: vi.fn(), studyAccess: vi.fn(), list: vi.fn(), listOrg: vi.fn() }
})

vi.mock('@ichtys/auth', () => ({
  AccessError: mocks.AccessError,
  validatePhiStudyAccess: mocks.studyAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('../../../../../lib/access/org-context', () => ({ resolveOrgAccessContext: mocks.orgContext }))
vi.mock('../../../../../lib/dictation/audio-store', () => ({ listUnassignedAudiosByAuthor: mocks.list, listUnassignedAudiosOfOrg: mocks.listOrg }))

import { GET } from '../route'

const NOW = new Date('2026-11-14T22:00:00Z')
const row = (over: Record<string, unknown> = {}) => ({
  id: 'dep-1',
  studyId: 'study-1',
  evolutionId: 'evo-1',
  take: 1,
  durationSec: 95,
  createdBy: 'user_me',
  createdAt: new Date('2026-11-10T12:00:00Z'),
  expiresAt: new Date('2026-12-10T12:00:00Z'),
  purgedAt: null,
  declaredAt: new Date('2026-11-14T15:00:00Z'),
  ...over,
})

// Por defecto: modo estricto, investiga y no coordina.
const ctx = (access: Record<string, unknown> = {}) => ({ orgId: 'org-1', userId: 'user_me', access: { mode: 'enforced', role: 'principal_investigator', functions: ['investigator'], ...access } })

async function list() {
  const res = await GET()
  return { res, body: res.status === 200 ? ((await res.json()) as { audios: Array<Record<string, unknown>> }) : null }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.orgContext.mockReset().mockResolvedValue(ctx())
  mocks.listOrg.mockReset().mockResolvedValue([])
  mocks.studyAccess.mockReset().mockImplementation(async (studyId: string) => ({ study: { id: studyId, name: `Estudio ${studyId}` } }))
  mocks.list.mockReset().mockResolvedValue([row()])
})

describe('GET — mis grabaciones sin sujeto', () => {
  it('pide las de esta persona en su organización, y nada más', async () => {
    await list()
    expect(mocks.list).toHaveBeenCalledWith({ orgId: 'org-1', userId: 'user_me' })
  })

  it('devuelve lo necesario para reconocerla, sin contenido ni quién la declaró', async () => {
    const { res, body } = await list()
    expect(res.status).toBe(200)
    expect(body!.audios).toEqual([
      {
        id: 'dep-1',
        studyId: 'study-1',
        studyName: 'Estudio study-1',
        take: 1,
        durationSec: 95,
        recordedAt: '2026-11-10T12:00:00.000Z',
        withdrawnAt: '2026-11-14T15:00:00.000Z',
        expiresAt: '2026-12-10T12:00:00.000Z',
        available: true,
        own: true,
      },
    ])
  })

  it('una vencida o ya borrada queda como constancia, sin poder escucharse', async () => {
    mocks.list.mockResolvedValue([
      row({ id: 'vencida', expiresAt: new Date('2026-11-14T21:59:59Z') }),
      row({ id: 'borrada', purgedAt: new Date('2026-11-12T00:00:00Z') }),
    ])
    const { body } = await list()
    expect(body!.audios.map((a) => [a.id, a.available])).toEqual([
      ['vencida', false],
      ['borrada', false],
    ])
  })

  it('si ya no tiene acceso al estudio, esa grabación no aparece; las de otros estudios sí', async () => {
    mocks.list.mockResolvedValue([row({ id: 'a', studyId: 'study-1' }), row({ id: 'b', studyId: 'study-2' }), row({ id: 'c', studyId: 'study-1' })])
    mocks.studyAccess.mockImplementation(async (studyId: string) => {
      if (studyId === 'study-1') throw new mocks.AccessError('Forbidden', 403)
      return { study: { id: studyId, name: 'Estudio dos' } }
    })
    const { body } = await list()
    expect(body!.audios.map((a) => a.id)).toEqual(['b'])
    // Una comprobación por estudio, no por grabación.
    expect(mocks.studyAccess).toHaveBeenCalledTimes(2)
  })

  it('un estudio que ya no existe para esta persona (404) tampoco aparece', async () => {
    mocks.studyAccess.mockRejectedValue(new mocks.AccessError('Not Found', 404))
    expect((await list()).body!.audios).toEqual([])
  })

  it('si el depósito devolviera una grabación de otra persona, no sale', async () => {
    mocks.list.mockResolvedValue([row({ id: 'ajena', createdBy: 'user_otro' }), row({ id: 'mia' })])
    expect((await list()).body!.audios.map((a) => a.id)).toEqual(['mia'])
  })

  it('sin grabaciones no se comprueba ningún estudio', async () => {
    mocks.list.mockResolvedValue([])
    const { body } = await list()
    expect(body!.audios).toEqual([])
    expect(mocks.studyAccess).not.toHaveBeenCalled()
  })

  it('si comprobar el acceso falla por otra cosa que un permiso, no se entrega una lista a medias', async () => {
    mocks.studyAccess.mockRejectedValue(new Error('sin conexión'))
    expect((await list()).res.status).toBe(500)
  })

  it('sin sesión: 401, y no se consulta nada', async () => {
    mocks.orgContext.mockRejectedValue(new mocks.AccessError('Unauthorized', 401))
    expect((await list()).res.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

describe('GET — quien coordina ve también las de otras personas, de los estudios a los que entra', () => {
  const rows = () => [row({ id: 'mia' }), row({ id: 'ajena', createdBy: 'user_otro' }), row({ id: 'ajena-otro-estudio', createdBy: 'user_otro', studyId: 'study-2' })]

  it('modo estricto, con la función de coordinar: pide las de la organización y marca cuáles son suyas', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ functions: ['study_coordinator'] }))
    mocks.listOrg.mockResolvedValue(rows())
    const { body } = await list()
    expect(mocks.listOrg).toHaveBeenCalledWith({ orgId: 'org-1' })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(body!.audios.map((a) => [a.id, a.own])).toEqual([
      ['mia', true],
      ['ajena', false],
      ['ajena-otro-estudio', false],
    ])
  })

  it('coordinar no alcanza sin entrar al estudio: las de un estudio al que no pertenece no aparecen', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ functions: ['study_coordinator'] }))
    mocks.listOrg.mockResolvedValue(rows())
    mocks.studyAccess.mockImplementation(async (studyId: string) => {
      if (studyId === 'study-2') throw new mocks.AccessError('Not Found', 404)
      return { study: { id: studyId, name: 'Estudio uno' } }
    })
    expect((await list()).body!.audios.map((a) => a.id)).toEqual(['mia', 'ajena'])
  })

  it('modo abierto: la coordinación del centro las ve; un investigador sigue viendo solo las suyas', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ mode: 'open', role: 'site_coordinator', functions: [] }))
    mocks.listOrg.mockResolvedValue(rows())
    expect((await list()).body!.audios).toHaveLength(3)

    mocks.orgContext.mockResolvedValue(ctx({ mode: 'open', role: 'principal_investigator', functions: [] }))
    mocks.listOrg.mockClear()
    mocks.list.mockResolvedValue([row({ id: 'mia' })])
    expect((await list()).body!.audios.map((a) => a.id)).toEqual(['mia'])
    expect(mocks.listOrg).not.toHaveBeenCalled()
  })

  it('modo abierto: tener cargada la función de coordinar no alcanza', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ mode: 'open', role: 'principal_investigator', functions: ['study_coordinator'] }))
    await list()
    expect(mocks.listOrg).not.toHaveBeenCalled()
  })
})

