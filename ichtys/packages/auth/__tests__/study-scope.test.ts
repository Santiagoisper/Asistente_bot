import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ where: vi.fn() }))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  isNull: vi.fn((column: unknown) => ({ isNull: column })),
  gt: vi.fn((left: unknown, right: unknown) => ({ gt: left, than: right })),
  or: vi.fn((...alternatives: unknown[]) => ({ alternatives })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ inArray: column, values })),
  sql: (strings: TemplateStringsArray) => ({ sql: strings.join('') }),
}))

vi.mock('@ichtys/db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: mocks.where })) })) },
  studyMemberships: {
    studyId: 'sm.study_id',
    organizationId: 'sm.organization_id',
    userId: 'sm.user_id',
    revokedAt: 'sm.revoked_at',
    expiresAt: 'sm.expires_at',
  },
}))

import type { AccessSubject } from '../functions'
import {
  loadStudyScope,
  scopeIncludesStudy,
  studyScopeFilter,
  studyScopeOrOrgLevelFilter,
  type StudyScope,
} from '../study-scope'

const COLUMN = 'tabla.study_id' as never
const base = { orgId: 'org-1', userId: 'user-1' }
const enforced = (...functions: AccessSubject['functions'][number][]): AccessSubject => ({
  mode: 'enforced',
  role: 'site_coordinator',
  functions,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.where.mockResolvedValue([])
})

describe('loadStudyScope', () => {
  it('open: ve todos los estudios y no consulta membresías', async () => {
    const scope = await loadStudyScope({ ...base, access: { mode: 'open', role: 'read_only_monitor', functions: [] } })
    expect(scope).toEqual({ kind: 'all' })
    expect(mocks.where).not.toHaveBeenCalled()
  })

  it('enforced: las dos direcciones ven todos sin consultar (M10)', async () => {
    expect(await loadStudyScope({ ...base, access: enforced('operations_director') })).toEqual({ kind: 'all' })
    expect(await loadStudyScope({ ...base, access: enforced('research_director') })).toEqual({ kind: 'all' })
    expect(mocks.where).not.toHaveBeenCalled()
  })

  it('enforced: el resto ve solo los estudios con membresía vigente, sin repetidos', async () => {
    mocks.where.mockResolvedValue([{ studyId: 'a' }, { studyId: 'b' }, { studyId: 'a' }])
    expect(await loadStudyScope({ ...base, access: enforced('investigator') })).toEqual({ kind: 'ids', studyIds: ['a', 'b'] })
  })

  it('enforced: sin membresías el alcance es una lista vacía, nunca «todos»', async () => {
    for (const fn of ['investigator', 'study_coordinator', 'lab_assistant', 'monitor'] as const) {
      expect(await loadStudyScope({ ...base, access: enforced(fn) }), fn).toEqual({ kind: 'ids', studyIds: [] })
    }
    expect(await loadStudyScope({ ...base, access: enforced() })).toEqual({ kind: 'ids', studyIds: [] })
  })

  it('enforced: sin `study.read` no ve ningún estudio aunque conserve membresías, y ni siquiera se consultan', async () => {
    mocks.where.mockResolvedValue([{ studyId: 'a' }])
    // Quien solo administra la plataforma (M12) y quien quedó sin funciones.
    expect(await loadStudyScope({ ...base, access: enforced('platform_admin') })).toEqual({ kind: 'ids', studyIds: [] })
    expect(await loadStudyScope({ ...base, access: enforced() })).toEqual({ kind: 'ids', studyIds: [] })
    expect(mocks.where).not.toHaveBeenCalled()
    // Con una función que sí entra a estudios, la misma membresía cuenta.
    expect(await loadStudyScope({ ...base, access: enforced('platform_admin', 'monitor') })).toEqual({ kind: 'ids', studyIds: ['a'] })
  })

  it('la consulta filtra por organización y persona, y descarta bajas y vencidas', async () => {
    const now = new Date('2026-11-12T12:00:00Z')
    await loadStudyScope({ ...base, now, access: enforced('investigator') })
    expect(mocks.where.mock.calls[0]?.[0]).toEqual({
      conditions: [
        { left: 'sm.organization_id', right: 'org-1' },
        { left: 'sm.user_id', right: 'user-1' },
        { isNull: 'sm.revoked_at' },
        { alternatives: [{ isNull: 'sm.expires_at' }, { gt: 'sm.expires_at', than: now }] },
      ],
    })
  })
})

describe('studyScopeFilter', () => {
  const some: StudyScope = { kind: 'ids', studyIds: ['a', 'b'] }
  const none: StudyScope = { kind: 'ids', studyIds: [] }

  it('«todos» no agrega condición', () => {
    expect(studyScopeFilter({ kind: 'all' }, COLUMN)).toBeUndefined()
  })

  it('una lista limita la columna a esos estudios', () => {
    expect(studyScopeFilter(some, COLUMN)).toEqual({ inArray: 'tabla.study_id', values: ['a', 'b'] })
  })

  it('una lista vacía es una condición que nunca se cumple, no la ausencia de filtro', () => {
    expect(studyScopeFilter(none, COLUMN)).toEqual({ sql: 'false' })
  })

  it('la variante con eventos de la organización deja pasar las filas sin estudio, y solo esas cuando la lista está vacía', () => {
    expect(studyScopeOrOrgLevelFilter({ kind: 'all' }, COLUMN)).toBeUndefined()
    expect(studyScopeOrOrgLevelFilter(some, COLUMN)).toEqual({
      alternatives: [{ isNull: 'tabla.study_id' }, { inArray: 'tabla.study_id', values: ['a', 'b'] }],
    })
    expect(studyScopeOrOrgLevelFilter(none, COLUMN)).toEqual({
      alternatives: [{ isNull: 'tabla.study_id' }, { sql: 'false' }],
    })
  })

  it('scopeIncludesStudy', () => {
    expect(scopeIncludesStudy({ kind: 'all' }, 'x')).toBe(true)
    expect(scopeIncludesStudy(some, 'a')).toBe(true)
    expect(scopeIncludesStudy(some, 'x')).toBe(false)
    expect(scopeIncludesStudy(none, 'a')).toBe(false)
  })
})
