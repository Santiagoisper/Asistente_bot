/**
 * GET /api/org/team/history — «qué cambió y quién» (docs/decisions/study-membership.md,
 * paso 5). Sesión, organización, modo y funciones son los reales; la base es el
 * fixture, que evalúa la condición, el orden y el tope de la consulta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFixture, fx } from '../../../../../../lib/access/__tests__/access-db-fixture'

vi.mock('@ichtys/db', async (importOriginal) => {
  const { makeDbMock } = await import('../../../../../../lib/access/__tests__/access-db-fixture')
  return makeDbMock((await importOriginal()) as Record<string, unknown>)
})
vi.mock('drizzle-orm', async (importOriginal) => {
  const operators = await import('../../../../../../lib/access/__tests__/access-operators')
  return { ...((await importOriginal()) as object), ...operators }
})
vi.mock('../../../../../../lib/subjects/evolution-reader', async () => {
  const { evolutionReaderMock } = await import('../../../../../../lib/access/__tests__/access-db-fixture')
  return evolutionReaderMock()
})
vi.mock('@clerk/nextjs/server', async () => {
  const { clerkServerMock } = await import('../../../../../../lib/access/__tests__/access-db-fixture')
  return clerkServerMock()
})

import { GET } from '../route'

const url = (query = '') => new Request(`http://localhost/api/org/team/history${query}`)

let nextId = 1
const audit = (row: {
  org?: string
  action: string
  at: string
  actor?: string
  studyId?: string | null
  metadata?: Record<string, unknown> | null
}) => ({
  id: nextId++,
  organizationId: row.org ?? 'org-1',
  studyId: row.studyId ?? null,
  userId: row.actor ?? 'user-1',
  action: row.action,
  resourceType: 'member_function',
  resourceId: null,
  metadata: row.metadata === undefined ? {} : row.metadata,
  ipAddress: null,
  createdAt: new Date(row.at),
})

beforeEach(() => {
  resetFixture()
  nextId = 1
  fx.auditRows = [
    audit({ action: 'access.function.grant', at: '2026-11-10T10:00:00Z', metadata: { memberUserId: 'user-2', functionKey: 'investigator', selfAssigned: false, changed: true, mode: 'open' } }),
    audit({ action: 'access.membership.grant', at: '2026-11-10T11:00:00Z', studyId: 'study-1', metadata: { memberUserId: 'user-2', selfAssigned: false, hasExpiry: false, mode: 'open' } }),
    // Pedido repetido: no cambió nada. Queda en la auditoría, no en el historial.
    audit({ action: 'access.function.grant', at: '2026-11-10T12:00:00Z', metadata: { memberUserId: 'user-2', functionKey: 'investigator', selfAssigned: false, changed: false, mode: 'open' } }),
    audit({ action: 'access.function.revoke', at: '2026-11-11T09:00:00Z', actor: 'user-3', metadata: { memberUserId: 'user-3', functionKey: 'monitor', selfRevoked: true, changed: true, mode: 'open' } }),
    audit({ action: 'org.access_mode.update', at: '2026-11-12T09:00:00Z', metadata: { from: 'open', to: 'enforced', columnModeBefore: 'open', deadline: null, changed: true } }),
    // Otra acción de la misma organización: no es de accesos.
    audit({ action: 'lab.confirm', at: '2026-11-12T10:00:00Z', metadata: { memberUserId: 'user-2' } }),
    // Otra organización: nunca aparece.
    audit({ org: 'org-2', action: 'access.function.grant', at: '2026-11-13T09:00:00Z', actor: 'user-x', metadata: { memberUserId: 'user-x', functionKey: 'platform_admin', changed: true } }),
  ]
})

describe('GET /api/org/team/history — autorización', () => {
  it('sin sesión: 401', async () => {
    fx.auth = { userId: null, orgId: null, orgRole: null }
    expect((await GET(url())).status).toBe(401)
  })

  it('modo open: study_admin no ve el historial (lista a todo el personal)', async () => {
    fx.auth = { userId: 'user-3', orgId: 'org_clerk_1', orgRole: 'org:study_admin' }
    expect((await GET(url())).status).toBe(403)
  })

  it('modo enforced: un investigador sin la función de administración tampoco', async () => {
    fx.org.accessMode = 'enforced'
    fx.memberFunctionRows.push({ id: 'mf-3', organizationId: 'org-1', userId: 'user-2', functionKey: 'investigator', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null })
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:principal_investigator' }
    expect((await GET(url())).status).toBe(403)
  })
})

describe('GET /api/org/team/history — contenido', () => {
  it('solo cambios de accesos de esta organización, de lo más nuevo a lo más viejo', async () => {
    const res = await GET(url())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries.map((e: { action: string }) => e.action)).toEqual([
      'org.access_mode.update',
      'access.function.revoke',
      'access.membership.grant',
      'access.function.grant',
    ])
    expect(body.next).toBeNull()
    expect(JSON.stringify(body)).not.toContain('user-x')
    expect(JSON.stringify(body)).not.toContain('lab.confirm')
  })

  it('cada entrada dice quién, a quién y qué; la metadata no pasa tal cual', async () => {
    const body = await (await GET(url())).json()
    const [mode, revoke, membership, grant] = body.entries
    expect(grant).toEqual({
      id: 1,
      at: '2026-11-10T10:00:00.000Z',
      action: 'access.function.grant',
      actorUserId: 'user-1',
      memberUserId: 'user-2',
      functionKey: 'investigator',
      studyId: null,
      self: false,
      hasExpiry: null,
      modeFrom: null,
      modeTo: null,
      openUntil: null,
    })
    expect(membership).toMatchObject({ studyId: 'study-1', memberUserId: 'user-2', hasExpiry: false })
    expect(revoke).toMatchObject({ actorUserId: 'user-3', memberUserId: 'user-3', functionKey: 'monitor', self: true })
    expect(mode).toMatchObject({ modeFrom: 'open', modeTo: 'enforced', memberUserId: null })
    // Campos internos de la auditoría (modo de la petición, columna previa) no salen.
    expect(Object.keys(grant)).not.toContain('mode')
    expect(JSON.stringify(body)).not.toContain('columnModeBefore')
  })

  it('pagina con cursor sin repetir ni saltear entradas', async () => {
    const first = await (await GET(url('?limit=2'))).json()
    expect(first.entries.map((e: { id: number }) => e.id)).toEqual([5, 4])
    // El cursor es el id de la última fila leída: no se trunca como una fecha.
    expect(first.next).toBe('4')

    const second = await (await GET(url(`?limit=2&before=${first.next}`))).json()
    // La fila 3 (changed:false) no ocupa lugar: la página se llena con 2 y 1.
    expect(second.entries.map((e: { id: number }) => e.id)).toEqual([2, 1])
    expect(second.next).toBeNull()
  })

  it('muchos pedidos sin cambio arriba de todo: la primera página igual se llena', async () => {
    nextId = 1
    fx.auditRows = [
      audit({ action: 'access.function.grant', at: '2026-11-01T10:00:00Z', metadata: { memberUserId: 'user-2', functionKey: 'investigator', changed: true } }),
      audit({ action: 'access.function.grant', at: '2026-11-02T10:00:00Z', metadata: { memberUserId: 'user-2', functionKey: 'monitor', changed: true } }),
      ...Array.from({ length: 12 }, (_, i) =>
        audit({ action: 'access.function.grant', at: `2026-11-03T10:00:${String(i).padStart(2, '0')}Z`, metadata: { memberUserId: 'user-2', functionKey: 'monitor', changed: false } }),
      ),
    ]
    const body = await (await GET(url('?limit=2'))).json()
    expect(body.entries.map((e: { id: number }) => e.id)).toEqual([2, 1])
    expect(body.next).toBeNull()
  })

  it('una carrera perdida al fijar el plazo (changed:false) no figura como cambio', async () => {
    nextId = 1
    fx.auditRows = [
      audit({ action: 'org.access_mode.deadline_set', at: '2026-11-01T10:00:00Z', metadata: { days: 60, openUntil: '2026-12-31T10:00:00.000Z', changed: true } }),
      audit({ action: 'org.access_mode.deadline_set', at: '2026-11-01T10:00:00Z', actor: 'user-3', metadata: { days: 60, openUntil: '2026-12-31T10:00:01.000Z', changed: false } }),
    ]
    const body = await (await GET(url())).json()
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toMatchObject({ id: 1, actorUserId: 'user-1', openUntil: '2026-12-31T10:00:00.000Z' })
  })

  it('dos registros en el mismo instante: el cursor desempata por id', async () => {
    nextId = 1
    fx.auditRows = [
      audit({ action: 'access.function.grant', at: '2026-11-10T10:00:00Z', metadata: { memberUserId: 'user-2', functionKey: 'investigator', changed: true } }),
      audit({ action: 'access.function.grant', at: '2026-11-10T10:00:00Z', metadata: { memberUserId: 'user-3', functionKey: 'monitor', changed: true } }),
    ]
    const first = await (await GET(url('?limit=1'))).json()
    expect(first.entries.map((e: { id: number }) => e.id)).toEqual([2])
    const second = await (await GET(url(`?limit=1&before=${first.next}`))).json()
    expect(second.entries.map((e: { id: number }) => e.id)).toEqual([1])
    expect(second.next).toBeNull()
  })

  it.each([
    ['?limit=0'],
    ['?limit=101'],
    ['?limit=abc'],
    ['?before=ayer'],
    ['?before=2026-11-10T10:00:00Z'],
    ['?before=0'],
    ['?before=-1'],
    ['?before=1.5'],
  ])('entrada inválida %s: 400 sin consultar', async (query) => {
    const res = await GET(url(query))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
  })

  it('una función fuera de la lista cerrada no se muestra como si fuera una', async () => {
    nextId = 1
    fx.auditRows = [
      audit({ action: 'access.function.grant', at: '2026-11-10T10:00:00Z', metadata: { memberUserId: 'user-2', functionKey: 'superusuario', changed: true } }),
    ]
    const body = await (await GET(url())).json()
    expect(body.entries[0].functionKey).toBeNull()
  })
})
