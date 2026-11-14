/**
 * /api/org/team/mode — estado, plazo e impacto del modo de acceso, y su cambio
 * (docs/decisions/study-membership.md, M5/M8 y «Cambio de modo»). De punta a
 * punta: sesión, organización, modo y funciones reales; base y Clerk del
 * fixture. La matriz fina de canSwitchMode y el preview viven en
 * lib/access/__tests__/mode-rules.test.ts.
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
vi.mock('@clerk/nextjs/server', async () => {
  const { clerkServerMock } = await import('../../../../../../lib/access/__tests__/access-db-fixture')
  return clerkServerMock()
})

import { GET, PUT } from '../route'

const DAY = 24 * 60 * 60 * 1000
const inDays = (days: number): Date => new Date(Date.now() + days * DAY)

async function put(body: unknown): Promise<Response> {
  return PUT(new Request('http://localhost/api/org/team/mode', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  resetFixture()
  // Centro del fixture: Ana administra (rol org:admin), Beto investiga con
  // membresía a study-1, Carla (study_admin) sin funciones ni membresías.
  fx.memberFunctionRows = [
    { id: 'mf-1', organizationId: 'org-1', userId: 'user-2', functionKey: 'investigator', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
  ]
  fx.membershipRows = [
    { id: 'sm-1', organizationId: 'org-1', studyId: 'study-1', userId: 'user-2', studyLabel: 'PI', expiresAt: null, createdBy: 'user-1', createdAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
  ]
})

describe('GET /api/org/team/mode — autorización', () => {
  it('sin sesión: 401', async () => {
    fx.auth = { userId: null, orgId: null, orgRole: null }
    expect((await GET()).status).toBe(401)
  })

  it('quien no administra accesos: 403', async () => {
    fx.auth = { userId: 'user-3', orgId: 'org_clerk_1', orgRole: 'org:study_admin' }
    expect((await GET()).status).toBe(403)
  })
})

describe('GET /api/org/team/mode — el plazo (M5/M8)', () => {
  it('open sin plazo lo asigna a 60 días y lo registra en la misma transacción', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { mode: string; openUntil: string; daysLeft: number; impact: unknown }

    expect(body.mode).toBe('open')
    expect(body.daysLeft).toBe(60)
    expect(fx.org.accessOpenUntil).toBeInstanceOf(Date) // la tabla quedó con el plazo
    expect(fx.audits).toHaveLength(1)
    expect(fx.audits[0]?.values).toMatchObject({
      action: 'org.access_mode.deadline_set',
      organizationId: 'org-1',
      userId: 'user-1',
    })
    expect(fx.audits[0]?.values.metadata).toMatchObject({ days: 60 })
  })

  it('un plazo ya asignado no se pisa: no hay segunda escritura', async () => {
    fx.org.accessOpenUntil = inDays(30)
    const body = (await (await GET()).json()) as { daysLeft: number }

    expect(body.daysLeft).toBe(30)
    expect(fx.audits).toHaveLength(0)
    expect(fx.transactions).toBe(0)
  })

  it('la organización en enforced no recibe plazo nuevo', async () => {
    fx.org.accessMode = 'enforced'
    const body = (await (await GET()).json()) as { mode: string; openUntil: string | null }

    expect(body.mode).toBe('enforced')
    expect(body.openUntil).toBeNull()
    expect(fx.audits).toHaveLength(0)
  })
})

describe('GET /api/org/team/mode — el impacto del paso a estricto', () => {
  it('nombra quién pierde qué, quién queda sin nada y quién deja de evolucionar', async () => {
    const body = (await (await GET()).json()) as {
      impact: Array<{ userId: string; name: string | null; losesStudies: Array<{ studyName: string }>; losesAllStudies: boolean; stopsAuthoring: boolean }>
    }

    const ana = body.impact.find((p) => p.userId === 'user-1')
    const carla = body.impact.find((p) => p.userId === 'user-3')
    // Ana y Carla no tienen funciones ni membresías: pierden el estudio y la
    // autoría que hoy les da el rol. Beto (investigator + membresía) no figura.
    expect(ana?.losesStudies.map((s) => s.studyName)).toEqual(['Metabólica'])
    expect(ana?.losesAllStudies).toBe(true)
    expect(ana?.stopsAuthoring).toBe(true)
    expect(carla?.losesAllStudies).toBe(true)
    expect(body.impact.some((p) => p.userId === 'user-2')).toBe(false)
  })

  it('sin pérdidas ni autoría en riesgo, la lista viene vacía', async () => {
    // Todos con alcance o membresía, y quien evoluciona por rol con la función
    // que en estricto lo permite (M15): nadie pierde nada.
    fx.memberFunctionRows.push(
      { id: 'mf-2', organizationId: 'org-1', userId: 'user-1', functionKey: 'operations_director', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
      { id: 'mf-2b', organizationId: 'org-1', userId: 'user-1', functionKey: 'investigator', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
      { id: 'mf-3', organizationId: 'org-1', userId: 'user-3', functionKey: 'study_coordinator', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
      { id: 'mf-3b', organizationId: 'org-1', userId: 'user-3', functionKey: 'investigator', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
    )
    fx.membershipRows.push(
      { id: 'sm-2', organizationId: 'org-1', studyId: 'study-1', userId: 'user-3', studyLabel: null, expiresAt: null, createdBy: 'user-1', createdAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
    )
    const body = (await (await GET()).json()) as { impact: unknown[] }
    expect(body.impact).toEqual([])
  })

  it('en modo estricto no hay impacto que mostrar', async () => {
    fx.org.accessMode = 'enforced'
    const body = (await (await GET()).json()) as { impact: unknown }
    expect(body.impact).toBeNull()
  })
})

describe('PUT /api/org/team/mode — el cambio', () => {
  it('sin sesión: 401; quien no administra: 403', async () => {
    fx.auth = { userId: null, orgId: null, orgRole: null }
    expect((await put({ mode: 'enforced' })).status).toBe(401)

    resetFixture()
    fx.auth = { userId: 'user-3', orgId: 'org_clerk_1', orgRole: 'org:study_admin' }
    expect((await put({ mode: 'enforced' })).status).toBe(403)
  })

  it('un modo que no existe: 400 invalid_input', async () => {
    const res = await put({ mode: 'strict' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_input')
  })

  it('open → enforced: cambia la columna y queda registrado con desde y hacia', async () => {
    const res = await put({ mode: 'enforced' })
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toBe(true)

    expect(fx.org.accessMode).toBe('enforced')
    expect(fx.audits).toHaveLength(1)
    expect(fx.audits[0]?.values).toMatchObject({
      action: 'org.access_mode.update',
      organizationId: 'org-1',
      userId: 'user-1',
    })
    expect(fx.audits[0]?.values.metadata).toMatchObject({ from: 'open', to: 'enforced', changed: true })
  })

  it('pedir el modo que ya rige: sin efecto, y el intento igual queda registrado', async () => {
    fx.org.accessMode = 'enforced'
    const res = await put({ mode: 'enforced' })
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toBe(false)
    expect(fx.audits[0]?.values.metadata).toMatchObject({ changed: false })
  })

  it('enforced → open antes del plazo: se puede', async () => {
    fx.org.accessMode = 'enforced'
    fx.org.accessOpenUntil = inDays(10)

    const res = await put({ mode: 'open' })
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toBe(true)
    expect(fx.org.accessMode).toBe('open')
  })

  it('enforced → open con el plazo vencido: 422 y nada cambia', async () => {
    fx.org.accessMode = 'enforced'
    fx.org.accessOpenUntil = inDays(-1)

    const res = await put({ mode: 'open' })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('deadline_passed')
    expect(fx.org.accessMode).toBe('enforced')
    expect(fx.audits).toHaveLength(0)
  })

  it('columna open con plazo vencido: rige como enforced — volver se niega, oficializar cambia la columna', async () => {
    fx.org.accessOpenUntil = inDays(-1)

    const denied = await put({ mode: 'open' })
    expect(denied.status).toBe(422)
    expect((await denied.json()).error).toBe('deadline_passed')
    expect(fx.org.accessMode).toBe('open') // la columna no se toca

    const official = await put({ mode: 'enforced' })
    expect(official.status).toBe(200)
    expect((await official.json()).changed).toBe(true)
    expect(fx.org.accessMode).toBe('enforced')
    expect(fx.audits[0]?.values.metadata).toMatchObject({ from: 'enforced', columnModeBefore: 'open' })
  })

  it('R3: si el registro de auditoría falla, el modo no cambia', async () => {
    fx.failAudit = true
    const res = await put({ mode: 'enforced' })
    expect(res.status).toBe(500)
    expect(fx.org.accessMode).toBe('open')
    expect(fx.audits).toHaveLength(0)
  })
})
