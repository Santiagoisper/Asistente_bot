import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Qué le piden a la base las consultas de la lista «Grabaciones sin sujeto» (D24, punto 3).
 *
 * Hallazgo de revisión del #183: el tope de la lista se aplicaba a las grabaciones de toda la
 * organización, y la ruta sacaba después las de los estudios a los que la persona no entra. Las
 * descartadas ocupaban el cupo: con 200 más recientes en otro estudio, la pantalla decía «No
 * tenés grabaciones sin sujeto» habiendo alguna. El filtro por estudio tiene que ir en la
 * consulta, en el mismo `where` que la organización, antes del tope.
 *
 * La base está simulada: se registra qué se le pide, no qué devuelve Postgres. Que el `where`
 * se aplica antes que el `limit` lo garantiza SQL; acá se comprueba que el filtro está en el
 * `where` y que el tope sigue puesto.
 */
const h = vi.hoisted(() => {
  const state = { log: [] as Array<{ method: string; args: unknown[] }>, rows: [] as unknown[] }
  const columns = (table: string) => new Proxy({}, { get: (_t, prop) => `${table}.${String(prop)}` })
  const query = () => {
    const q: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy', 'limit']) {
      q[method] = (...args: unknown[]) => {
        state.log.push({ method, args })
        return q
      }
    }
    q.then = (resolve: (rows: unknown[]) => unknown, reject: (err: unknown) => unknown) => Promise.resolve(state.rows).then(resolve, reject)
    return q
  }
  const start = (method: string) => (...args: unknown[]) => {
    state.log.push({ method, args })
    return query()
  }
  return { state, columns, start }
})

vi.mock('@ichtys/db', () => ({
  db: { select: h.start('select'), selectDistinct: h.start('selectDistinct') },
  dictationAudios: h.columns('audios'),
  unassignedDictationAudios: h.columns('deposito'),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: (column: unknown, values: unknown) => ({ in: [column, values] }),
  desc: (column: unknown) => ({ desc: column }),
  lt: (column: unknown, value: unknown) => ({ lt: [column, value] }),
  isNull: (column: unknown) => ({ isNull: column }),
  isNotNull: (column: unknown) => ({ isNotNull: column }),
}))
vi.mock('../../subjects/phi-fields', () => ({ decryptClinicalContent: vi.fn(), encryptClinicalContent: vi.fn() }))

import {
  UNASSIGNED_AUDIO_LIST_MAX,
  listUnassignedAudioStudiesByAuthor,
  listUnassignedAudioStudiesOfOrg,
  listUnassignedAudiosByAuthor,
  listUnassignedAudiosOfOrg,
} from '../audio-store'

const methods = () => h.state.log.map((call) => call.method)
const argsOf = (method: string) => h.state.log.find((call) => call.method === method)?.args

beforeEach(() => {
  h.state.log = []
  h.state.rows = []
})

describe('la lista de quien coordina: las de la organización, solo de los estudios a los que entra', () => {
  it('el estudio se filtra en la consulta, junto con la organización, y el tope va después', async () => {
    h.state.rows = [{ id: 'dep-1' }]
    const rows = await listUnassignedAudiosOfOrg({ orgId: 'org-1', studyIds: ['3f2a9c1e-aaaa-4bbb-8ccc-0d1e2f3a4b5c', '7b8c9d0e-dddd-4eee-9fff-1a2b3c4d5e6f'] })

    expect(rows).toEqual([{ id: 'dep-1' }])
    expect(methods()).toEqual(['select', 'from', 'where', 'orderBy', 'limit'])
    expect(argsOf('from')).toEqual([expect.anything()])
    expect(argsOf('where')).toEqual([
      {
        and: [
          { eq: ['deposito.organizationId', 'org-1'] },
          { in: ['deposito.studyId', ['3f2a9c1e-aaaa-4bbb-8ccc-0d1e2f3a4b5c', '7b8c9d0e-dddd-4eee-9fff-1a2b3c4d5e6f']] },
        ],
      },
    ])
    expect(argsOf('orderBy')).toEqual([{ desc: 'deposito.declaredAt' }])
    expect(argsOf('limit')).toEqual([UNASSIGNED_AUDIO_LIST_MAX + 1])
  })

  it('sin ningún estudio permitido no hay nada que listar, y no se consulta la base', async () => {
    h.state.rows = [{ id: 'no-tiene-que-salir' }]
    expect(await listUnassignedAudiosOfOrg({ orgId: 'org-1', studyIds: [] })).toEqual([])
    expect(h.state.log).toEqual([])
  })
})

describe('la lista de quien grabó: las suyas, solo de los estudios a los que entra', () => {
  it('la persona y el estudio se filtran en la consulta, y el tope va después', async () => {
    await listUnassignedAudiosByAuthor({ orgId: 'org-1', userId: 'user_me', studyIds: ['3f2a9c1e-aaaa-4bbb-8ccc-0d1e2f3a4b5c'] })

    expect(methods()).toEqual(['select', 'from', 'where', 'orderBy', 'limit'])
    expect(argsOf('where')).toEqual([
      {
        and: [
          { eq: ['deposito.organizationId', 'org-1'] },
          { eq: ['deposito.createdBy', 'user_me'] },
          { in: ['deposito.studyId', ['3f2a9c1e-aaaa-4bbb-8ccc-0d1e2f3a4b5c']] },
        ],
      },
    ])
    expect(argsOf('orderBy')).toEqual([{ desc: 'deposito.declaredAt' }])
    expect(argsOf('limit')).toEqual([UNASSIGNED_AUDIO_LIST_MAX + 1])
  })

  it('sin ningún estudio permitido no hay nada que listar, y no se consulta la base', async () => {
    h.state.rows = [{ id: 'no-tiene-que-salir' }]
    expect(await listUnassignedAudiosByAuthor({ orgId: 'org-1', userId: 'user_me', studyIds: [] })).toEqual([])
    expect(h.state.log).toEqual([])
  })
})

describe('en qué estudios hay grabaciones sin sujeto: cada estudio una vez, sin tope', () => {
  it('los de la organización, para quien coordina', async () => {
    h.state.rows = [{ studyId: '3f2a9c1e-aaaa-4bbb-8ccc-0d1e2f3a4b5c' }, { studyId: '7b8c9d0e-dddd-4eee-9fff-1a2b3c4d5e6f' }]
    expect(await listUnassignedAudioStudiesOfOrg({ orgId: 'org-1' })).toEqual(['3f2a9c1e-aaaa-4bbb-8ccc-0d1e2f3a4b5c', '7b8c9d0e-dddd-4eee-9fff-1a2b3c4d5e6f'])

    // Sin tope: si se cortara, un estudio permitido podría quedar afuera y sus grabaciones no aparecer.
    expect(methods()).toEqual(['selectDistinct', 'from', 'where'])
    expect(argsOf('selectDistinct')).toEqual([{ studyId: 'deposito.studyId' }])
    expect(argsOf('where')).toEqual([{ eq: ['deposito.organizationId', 'org-1'] }])
  })

  it('los de las grabaciones de una persona, para quien no coordina', async () => {
    h.state.rows = [{ studyId: '3f2a9c1e-aaaa-4bbb-8ccc-0d1e2f3a4b5c' }]
    expect(await listUnassignedAudioStudiesByAuthor({ orgId: 'org-1', userId: 'user_me' })).toEqual(['3f2a9c1e-aaaa-4bbb-8ccc-0d1e2f3a4b5c'])

    expect(methods()).toEqual(['selectDistinct', 'from', 'where'])
    expect(argsOf('selectDistinct')).toEqual([{ studyId: 'deposito.studyId' }])
    expect(argsOf('where')).toEqual([{ and: [{ eq: ['deposito.organizationId', 'org-1'] }, { eq: ['deposito.createdBy', 'user_me'] }] }])
  })
})
