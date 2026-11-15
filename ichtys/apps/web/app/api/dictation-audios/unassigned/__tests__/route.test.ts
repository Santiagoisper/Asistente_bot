import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La lista «Grabaciones sin sujeto» (docs/decisions/grabacion-en-sujeto-equivocado.md, D24,
 * punto 3). Cada persona ve las suyas, de estudios a los que sigue teniendo acceso; quien
 * coordina ve también las de otras personas de esos estudios.
 *
 * El depósito está simulado con una lista en memoria que hace lo que tiene que hacer la consulta
 * de verdad: filtra (por persona y por los estudios que se le pasan) **y después** corta en el
 * tope. Así la prueba distingue «filtrar antes del tope» de «filtrar después»; qué pide la
 * consulta real está en `lib/dictation/__tests__/unassigned-list.test.ts`.
 */
const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  return { AccessError: MockAccessError, orgContext: vi.fn(), studyAccess: vi.fn(), list: vi.fn(), listOrg: vi.fn(), studies: vi.fn(), studiesOrg: vi.fn() }
})

vi.mock('@ichtys/auth', () => ({
  AccessError: mocks.AccessError,
  validatePhiStudyAccess: mocks.studyAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('../../../../../lib/access/org-context', () => ({ resolveOrgAccessContext: mocks.orgContext }))
vi.mock('../../../../../lib/dictation/audio-store', () => ({
  UNASSIGNED_AUDIO_LIST_MAX: 200,
  listUnassignedAudiosByAuthor: mocks.list,
  listUnassignedAudiosOfOrg: mocks.listOrg,
  listUnassignedAudioStudiesByAuthor: mocks.studies,
  listUnassignedAudioStudiesOfOrg: mocks.studiesOrg,
}))

import { GET } from '../route'

const NOW = new Date('2026-11-14T22:00:00Z')
/** El tope de la lista, el mismo número que `UNASSIGNED_AUDIO_LIST_MAX`. */
const CAP = 200
type Row = ReturnType<typeof row>
/** Lo que hay en el depósito de esta organización, lo más reciente primero. */
let deposit: Row[] = []
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
  return { res, body: res.status === 200 ? ((await res.json()) as { audios: Array<Record<string, unknown>>; truncated: boolean }) : null }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.orgContext.mockReset().mockResolvedValue(ctx())
  mocks.studyAccess.mockReset().mockImplementation(async (studyId: string) => ({ study: { id: studyId, name: `Estudio ${studyId}` } }))
  deposit = [row()]
  // Sin `studyIds` no se filtra por estudio: es lo que hacía la consulta antes de recibirlos.
  const inStudies = (r: Row, studyIds?: string[]) => studyIds === undefined || studyIds.includes(r.studyId)
  mocks.studies.mockReset().mockImplementation(async ({ userId }: { userId: string }) => [...new Set(deposit.filter((r) => r.createdBy === userId).map((r) => r.studyId))])
  mocks.studiesOrg.mockReset().mockImplementation(async () => [...new Set(deposit.map((r) => r.studyId))])
  mocks.list
    .mockReset()
    .mockImplementation(async ({ userId, studyIds }: { userId: string; studyIds?: string[] }) => deposit.filter((r) => r.createdBy === userId && inStudies(r, studyIds)).slice(0, CAP + 1))
  mocks.listOrg.mockReset().mockImplementation(async ({ studyIds }: { studyIds?: string[] }) => deposit.filter((r) => inStudies(r, studyIds)).slice(0, CAP + 1))
})

describe('GET — mis grabaciones sin sujeto', () => {
  it('pide las de esta persona en su organización, de los estudios a los que entra, y nada más', async () => {
    await list()
    expect(mocks.studies).toHaveBeenCalledWith({ orgId: 'org-1', userId: 'user_me' })
    expect(mocks.list).toHaveBeenCalledWith({ orgId: 'org-1', userId: 'user_me', studyIds: ['study-1'] })
    expect(mocks.studiesOrg).not.toHaveBeenCalled()
    expect(mocks.listOrg).not.toHaveBeenCalled()
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

  it('con el tope justo no dice que hay más', async () => {
    deposit = Array.from({ length: CAP }, (_, i) => row({ id: `dep-${i}` }))
    const { body } = await list()
    expect(body!.audios).toHaveLength(CAP)
    expect(body!.truncated).toBe(false)
  })

  it('con una más que el tope entrega las del tope, las más recientes, y dice que hay más', async () => {
    deposit = Array.from({ length: CAP + 1 }, (_, i) => row({ id: `dep-${i}` }))
    const { body } = await list()
    expect(body!.audios).toHaveLength(CAP)
    expect(body!.audios[0]!.id).toBe('dep-0')
    expect(body!.audios.at(-1)!.id).toBe(`dep-${CAP - 1}`)
    expect(body!.truncated).toBe(true)
  })

  it('sin grabaciones tampoco dice que hay más', async () => {
    deposit = []
    expect((await list()).body).toEqual({ audios: [], truncated: false })
  })

  it('lo que no se le muestra por no ser suyo o de su estudio no cuenta como «hay más» si el depósito no pasó del tope', async () => {
    deposit = [row(), row({ id: 'dep-2' })]
    mocks.list.mockResolvedValue([row(), row({ id: 'ajena', createdBy: 'user_other' })])
    const { body } = await list()
    expect(body!.audios.map((a) => a.id)).toEqual(['dep-1'])
    expect(body!.truncated).toBe(false)
  })

  it('una vencida o ya borrada queda como constancia, sin poder escucharse', async () => {
    deposit = [row({ id: 'vencida', expiresAt: new Date('2026-11-14T21:59:59Z') }), row({ id: 'borrada', purgedAt: new Date('2026-11-12T00:00:00Z') })]
    const { body } = await list()
    expect(body!.audios.map((a) => [a.id, a.available])).toEqual([
      ['vencida', false],
      ['borrada', false],
    ])
  })

  it('si ya no tiene acceso al estudio, esa grabación no aparece; las de otros estudios sí', async () => {
    deposit = [row({ id: 'a', studyId: 'study-1' }), row({ id: 'b', studyId: 'study-2' }), row({ id: 'c', studyId: 'study-1' })]
    mocks.studyAccess.mockImplementation(async (studyId: string) => {
      if (studyId === 'study-1') throw new mocks.AccessError('Forbidden', 403)
      return { study: { id: studyId, name: 'Estudio dos' } }
    })
    const { body } = await list()
    expect(body!.audios.map((a) => a.id)).toEqual(['b'])
    // Una comprobación por estudio, no por grabación.
    expect(mocks.studyAccess).toHaveBeenCalledTimes(2)
    // Y al depósito se le piden solo las del estudio al que entra.
    expect(mocks.list).toHaveBeenCalledWith({ orgId: 'org-1', userId: 'user_me', studyIds: ['study-2'] })
  })

  it('las propias de un estudio al que ya no entra no le sacan el lugar a las que sí puede ver', async () => {
    // 200 propias, más recientes, de un estudio que dejó; y una anterior de uno al que entra.
    deposit = [...Array.from({ length: CAP }, (_, i) => row({ id: `dejado-${i}`, studyId: 'study-dejado' })), row({ id: 'la-que-puede-ver', studyId: 'study-1' })]
    mocks.studyAccess.mockImplementation(async (studyId: string) => {
      if (studyId === 'study-dejado') throw new mocks.AccessError('Forbidden', 403)
      return { study: { id: studyId, name: 'Estudio uno' } }
    })
    expect((await list()).body!.audios.map((a) => a.id)).toEqual(['la-que-puede-ver'])
  })

  it('si no entra a ninguno de los estudios, no se le pide ninguna grabación al depósito', async () => {
    mocks.studyAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    const { res, body } = await list()
    expect(res.status).toBe(200)
    expect(body!.audios).toEqual([])
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('si el depósito devolviera una grabación de un estudio que no se le pidió, no sale', async () => {
    mocks.studies.mockResolvedValue(['study-1'])
    mocks.list.mockResolvedValue([row({ id: 'de-otro-estudio', studyId: 'study-9' }), row({ id: 'mia' })])
    const { body } = await list()
    expect(body!.audios.map((a) => a.id)).toEqual(['mia'])
    expect(mocks.studyAccess).toHaveBeenCalledTimes(1)
  })

  it('un estudio que ya no existe para esta persona (404) tampoco aparece', async () => {
    mocks.studyAccess.mockRejectedValue(new mocks.AccessError('Not Found', 404))
    expect((await list()).body!.audios).toEqual([])
  })

  it('si el depósito devolviera una grabación de otra persona, no sale', async () => {
    mocks.studies.mockResolvedValue(['study-1'])
    mocks.list.mockResolvedValue([row({ id: 'ajena', createdBy: 'user_otro' }), row({ id: 'mia' })])
    expect((await list()).body!.audios.map((a) => a.id)).toEqual(['mia'])
  })

  it('sin grabaciones no se comprueba ningún estudio ni se pide ninguna lista', async () => {
    deposit = []
    const { body } = await list()
    expect(body!.audios).toEqual([])
    expect(mocks.studyAccess).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('si comprobar el acceso falla por otra cosa que un permiso, no se entrega una lista a medias', async () => {
    mocks.studyAccess.mockRejectedValue(new Error('sin conexión'))
    expect((await list()).res.status).toBe(500)
  })

  it('sin sesión: 401, y no se consulta nada', async () => {
    mocks.orgContext.mockRejectedValue(new mocks.AccessError('Unauthorized', 401))
    expect((await list()).res.status).toBe(401)
    expect(mocks.studies).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

describe('GET — quien coordina ve también las de otras personas, de los estudios a los que entra', () => {
  const rows = () => [row({ id: 'mia' }), row({ id: 'ajena', createdBy: 'user_otro' }), row({ id: 'ajena-otro-estudio', createdBy: 'user_otro', studyId: 'study-2' })]

  it('modo estricto, con la función de coordinar: pide las de la organización y marca cuáles son suyas', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ functions: ['study_coordinator'] }))
    deposit = rows()
    const { body } = await list()
    expect(mocks.studiesOrg).toHaveBeenCalledWith({ orgId: 'org-1' })
    expect(mocks.listOrg).toHaveBeenCalledWith({ orgId: 'org-1', studyIds: ['study-1', 'study-2'] })
    expect(mocks.studies).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(body!.audios.map((a) => [a.id, a.own])).toEqual([
      ['mia', true],
      ['ajena', false],
      ['ajena-otro-estudio', false],
    ])
  })

  it('coordinar no alcanza sin entrar al estudio: las de un estudio al que no pertenece no aparecen', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ functions: ['study_coordinator'] }))
    deposit = rows()
    mocks.studyAccess.mockImplementation(async (studyId: string) => {
      if (studyId === 'study-2') throw new mocks.AccessError('Not Found', 404)
      return { study: { id: studyId, name: 'Estudio uno' } }
    })
    expect((await list()).body!.audios.map((a) => a.id)).toEqual(['mia', 'ajena'])
    // Al depósito no se le piden las del estudio al que no entra.
    expect(mocks.listOrg).toHaveBeenCalledWith({ orgId: 'org-1', studyIds: ['study-1'] })
  })

  // Hallazgo de revisión del #183: el tope se aplicaba a las grabaciones de toda la
  // organización y recién después se sacaban las de los estudios a los que la persona no
  // entra. Con 200 más recientes en otro estudio, la lista salía vacía habiendo una.
  it('las grabaciones de un estudio al que no entra no le sacan el lugar a las que sí puede ver', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ functions: ['study_coordinator'] }))
    deposit = [
      ...Array.from({ length: CAP }, (_, i) => row({ id: `otro-estudio-${i}`, studyId: 'study-b', createdBy: 'user_otro' })),
      row({ id: 'propia-anterior', studyId: 'study-a' }),
      row({ id: 'ajena-anterior', studyId: 'study-a', createdBy: 'user_otro' }),
    ]
    mocks.studyAccess.mockImplementation(async (studyId: string) => {
      if (studyId === 'study-b') throw new mocks.AccessError('Not Found', 404)
      return { study: { id: studyId, name: 'Estudio A' } }
    })
    const { res, body } = await list()
    expect(res.status).toBe(200)
    expect(body!.audios.map((a) => [a.id, a.own])).toEqual([
      ['propia-anterior', true],
      ['ajena-anterior', false],
    ])
  })

  it('quien coordina y no entra a ningún estudio con grabaciones: lista vacía, sin pedirle nada al depósito', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ functions: ['study_coordinator'] }))
    deposit = rows()
    mocks.studyAccess.mockRejectedValue(new mocks.AccessError('Not Found', 404))
    expect((await list()).body!.audios).toEqual([])
    expect(mocks.listOrg).not.toHaveBeenCalled()
  })

  it('modo abierto: la coordinación del centro las ve; un investigador sigue viendo solo las suyas', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ mode: 'open', role: 'site_coordinator', functions: [] }))
    deposit = rows()
    expect((await list()).body!.audios).toHaveLength(3)

    mocks.orgContext.mockResolvedValue(ctx({ mode: 'open', role: 'principal_investigator', functions: [] }))
    mocks.listOrg.mockClear()
    mocks.studiesOrg.mockClear()
    expect((await list()).body!.audios.map((a) => a.id)).toEqual(['mia'])
    expect(mocks.listOrg).not.toHaveBeenCalled()
    expect(mocks.studiesOrg).not.toHaveBeenCalled()
  })

  it('modo abierto: tener cargada la función de coordinar no alcanza', async () => {
    mocks.orgContext.mockResolvedValue(ctx({ mode: 'open', role: 'principal_investigator', functions: ['study_coordinator'] }))
    await list()
    expect(mocks.listOrg).not.toHaveBeenCalled()
    expect(mocks.studiesOrg).not.toHaveBeenCalled()
  })
})

