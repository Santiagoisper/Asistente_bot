import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El lector único de evoluciones (D24). Lo que se prueba acá es lo que el lector promete:
 * que quien pide las vigentes no recibe las anuladas, que quien las pide todas recibe la
 * marca de anulación, y que nadie puede leer sin decir cuál de las dos quiere.
 */
const mocks = vi.hoisted(() => {
  const calls = { where: [] as unknown[], join: [] as unknown[], order: [] as unknown[], limit: [] as number[] }
  const state = { rows: [] as unknown[] }
  const builder = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.leftJoin = (_table: unknown, on: unknown) => {
      calls.join.push(on)
      return chain
    }
    chain.where = (condition: unknown) => {
      calls.where.push(condition)
      return chain
    }
    chain.orderBy = (...order: unknown[]) => {
      calls.order.push(order)
      return chain
    }
    chain.limit = (count: number) => {
      calls.limit.push(count)
      return chain
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(state.rows).then(resolve)
    return chain
  }
  return { calls, state, builder }
})

vi.mock('@ichtys/db', () => {
  const column = (name: string) => ({ column: name })
  return {
    db: { select: () => mocks.builder(), selectDistinct: () => mocks.builder() },
    clinicalEvolutions: {
      id: column('evolution.id'),
      organizationId: column('evolution.org'),
      studyId: column('evolution.study'),
      subjectId: column('evolution.subject'),
      authorUserId: column('evolution.author'),
      visitLabel: column('evolution.visitLabel'),
      contentEncrypted: column('evolution.content'),
      dictationTakes: column('evolution.takes'),
      createdAt: column('evolution.createdAt'),
    },
    evolutionVoids: {
      id: column('void.id'),
      organizationId: column('void.org'),
      evolutionId: column('void.evolution'),
      reason: column('void.reason'),
      declaredBy: column('void.declaredBy'),
      declaredAt: column('void.declaredAt'),
    },
    and: (...parts: unknown[]) => ({ and: parts.filter((part) => part !== undefined) }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    isNull: (value: unknown) => ({ isNull: value }),
    desc: (value: unknown) => ({ desc: value }),
  }
})

import { findSubjectEvolution, listEvolutionAuthors, listSubjectEvolutions } from '../evolution-reader'

const SCOPE = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1' }
const ONLY_CURRENT = { isNull: { column: 'void.id' } }

function lastWhere(): { and: unknown[] } {
  return mocks.calls.where.at(-1) as { and: unknown[] }
}

beforeEach(() => {
  mocks.calls.where.length = 0
  mocks.calls.join.length = 0
  mocks.calls.order.length = 0
  mocks.calls.limit.length = 0
  mocks.state.rows = []
})

describe('listSubjectEvolutions', () => {
  it('pidiendo las vigentes, la consulta deja afuera las anuladas', async () => {
    await listSubjectEvolutions(SCOPE, 'current')
    expect(lastWhere().and).toContainEqual(ONLY_CURRENT)
  })

  it('pidiendo también las anuladas, no las filtra', async () => {
    await listSubjectEvolutions(SCOPE, 'with-voided')
    expect(lastWhere().and).not.toContainEqual(ONLY_CURRENT)
  })

  it('siempre acota por organización, estudio y sujeto', async () => {
    await listSubjectEvolutions(SCOPE, 'with-voided')
    expect(lastWhere().and).toEqual(
      expect.arrayContaining([
        { eq: [{ column: 'evolution.org' }, 'org-1'] },
        { eq: [{ column: 'evolution.study' }, 'study-1'] },
        { eq: [{ column: 'evolution.subject' }, 'subject-1'] },
      ]),
    )
  })

  it('la anulación se busca por evolución y por organización: la de otra organización no marca nada', async () => {
    await listSubjectEvolutions(SCOPE, 'with-voided')
    expect(mocks.calls.join.at(-1)).toEqual({
      and: [{ eq: [{ column: 'void.evolution' }, { column: 'evolution.id' }] }, { eq: [{ column: 'void.org' }, { column: 'evolution.org' }] }],
    })
  })

  it('devuelve cada evolución con su marca de anulación, o sin marca', async () => {
    const declaredAt = new Date('2026-11-14T15:00:00Z')
    mocks.state.rows = [
      { id: 'evo-anulada', visitLabel: 'V2', contentEncrypted: 'enc:a', authorUserId: 'user_a', dictationTakes: 2, createdAt: new Date('2026-11-14T12:00:00Z'), voidId: 'void-1', voidReason: 'wrong_subject', voidDeclaredBy: 'user_b', voidDeclaredAt: declaredAt },
      { id: 'evo-vigente', visitLabel: null, contentEncrypted: 'enc:b', authorUserId: 'user_a', dictationTakes: null, createdAt: new Date('2026-11-13T12:00:00Z'), voidId: null, voidReason: null, voidDeclaredBy: null, voidDeclaredAt: null },
    ]

    const rows = await listSubjectEvolutions(SCOPE, 'with-voided')

    expect(rows.map((row) => [row.id, row.voided])).toEqual([
      ['evo-anulada', { reason: 'wrong_subject', declaredBy: 'user_b', declaredAt }],
      ['evo-vigente', null],
    ])
    // Los campos de la unión no salen sueltos: quien llama mira `voided`.
    expect(rows[0]).not.toHaveProperty('voidId')
    expect(rows[0]).toMatchObject({ visitLabel: 'V2', contentEncrypted: 'enc:a', authorUserId: 'user_a', dictationTakes: 2 })
  })

  it('las ordena de la más nueva a la más vieja', async () => {
    await listSubjectEvolutions(SCOPE, 'current')
    expect(mocks.calls.order.at(-1)).toEqual([{ desc: { column: 'evolution.createdAt' } }])
  })
})

describe('findSubjectEvolution', () => {
  const params = { ...SCOPE, evolutionId: 'evo-1' }

  it('una anulada no se encuentra cuando se piden las vigentes', async () => {
    await findSubjectEvolution(params, 'current')
    expect(lastWhere().and).toContainEqual(ONLY_CURRENT)
    expect(lastWhere().and).toContainEqual({ eq: [{ column: 'evolution.id' }, 'evo-1'] })
  })

  it('la busca dentro de su organización, estudio y sujeto', async () => {
    await findSubjectEvolution(params, 'with-voided')
    expect(lastWhere().and).toEqual(
      expect.arrayContaining([
        { eq: [{ column: 'evolution.org' }, 'org-1'] },
        { eq: [{ column: 'evolution.study' }, 'study-1'] },
        { eq: [{ column: 'evolution.subject' }, 'subject-1'] },
      ]),
    )
    expect(lastWhere().and).not.toContainEqual(ONLY_CURRENT)
  })

  it('devuelve quién la escribió y si está anulada; si no existe, nada', async () => {
    expect(await findSubjectEvolution(params, 'current')).toBeNull()
    mocks.state.rows = [{ id: 'evo-1', authorUserId: 'user_a', voidId: null, voidReason: null, voidDeclaredBy: null, voidDeclaredAt: null }]
    expect(await findSubjectEvolution(params, 'current')).toEqual({ id: 'evo-1', authorUserId: 'user_a', voided: null })
  })
})

describe('listEvolutionAuthors', () => {
  it('acota por organización y respeta lo que se pide sobre las anuladas', async () => {
    mocks.state.rows = [{ userId: 'user_a' }, { userId: 'user_b' }]

    expect(await listEvolutionAuthors('org-1', 'with-voided')).toEqual(['user_a', 'user_b'])
    expect(lastWhere().and).toEqual([{ eq: [{ column: 'evolution.org' }, 'org-1'] }])

    await listEvolutionAuthors('org-1', 'current')
    expect(lastWhere().and).toContainEqual(ONLY_CURRENT)
  })
})
