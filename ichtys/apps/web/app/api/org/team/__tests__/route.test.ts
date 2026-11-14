/**
 * GET /api/org/team — el equipo del centro para quien administra accesos
 * (docs/decisions/study-membership.md, paso 5). La autorización se prueba de
 * punta a punta: sesión de Clerk, organización, modo y funciones son los
 * reales; solo la base (y Clerk) son el fixture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFixture, fx } from '../../../../../lib/access/__tests__/access-db-fixture'

vi.mock('@ichtys/db', async (importOriginal) => {
  // Imports dinámicos: las factories se hoistean antes que los imports del test.
  const { makeDbMock } = await import('../../../../../lib/access/__tests__/access-db-fixture')
  return makeDbMock((await importOriginal()) as Record<string, unknown>)
})
// Los validadores de packages/auth arman sus condiciones con operadores de
// drizzle-orm: se reemplazan por los inspeccionables del fixture y el resto
// del módulo queda real.
vi.mock('drizzle-orm', async (importOriginal) => {
  const operators = await import('../../../../../lib/access/__tests__/access-operators')
  return { ...((await importOriginal()) as object), ...operators }
})
vi.mock('@clerk/nextjs/server', async () => {
  const { clerkServerMock } = await import('../../../../../lib/access/__tests__/access-db-fixture')
  return clerkServerMock()
})

import { GET } from '../route'

beforeEach(() => {
  resetFixture()
  // Un centro con algo cargado: Beto investiga y entra al estudio; Carla (rol
  // study_admin, sin funciones) escribió evoluciones (M15); un externo que ya
  // se fue dejó una función colgada.
  fx.memberFunctionRows = [
    { id: 'mf-1', organizationId: 'org-1', userId: 'user-2', functionKey: 'investigator', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
    { id: 'mf-2', organizationId: 'org-1', userId: 'user-9', functionKey: 'monitor', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
  ]
  fx.membershipRows = [
    { id: 'sm-1', organizationId: 'org-1', studyId: 'study-1', userId: 'user-2', studyLabel: 'PI', expiresAt: null, createdBy: 'user-1', createdAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null },
  ]
  fx.evolutionRows = [{ organizationId: 'org-1', authorUserId: 'user-3' }]
})

describe('GET /api/org/team — autorización', () => {
  it('sin sesión: 401', async () => {
    fx.auth = { userId: null, orgId: null, orgRole: null }
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('modo open: solo el administrador de la organización; study_admin no ve el equipo', async () => {
    fx.auth = { userId: 'user-3', orgId: 'org_clerk_1', orgRole: 'org:study_admin' }
    expect((await GET()).status).toBe(403)
  })

  it('modo enforced: un rol alto sin la función de administración tampoco', async () => {
    fx.org.accessMode = 'enforced'
    fx.memberFunctionRows.push({ id: 'mf-3', organizationId: 'org-1', userId: 'user-2', functionKey: 'investigator', grantedBy: 'user-1', grantedAt: new Date('2026-11-01'), revokedAt: null, revokedBy: null })
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:principal_investigator' }
    expect((await GET()).status).toBe(403)
  })

  it('M14: en modo enforced el administrador de la organización entra sin funciones cargadas', async () => {
    fx.org.accessMode = 'enforced'
    fx.memberFunctionRows = fx.memberFunctionRows.filter((row) => row.userId !== 'user-1')
    // user-1 es org:admin y no tiene ninguna fila de función: loadAccessSubject
    // le inyecta platform_admin, que administra el equipo.
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).mode).toBe('enforced')
  })
})

describe('GET /api/org/team — contenido', () => {
  it('el equipo completo: funciones, estudios, sugerencias y marcados', async () => {
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.mode).toBe('open')
    expect(body.openUntil).toBeNull()
    expect(body.studies).toEqual([{ id: 'study-1', name: 'Metabólica' }])
    expect(body.orphanUserIds).toEqual(['user-9'])
    expect(body.truncated).toBe(false)

    const byUser = new Map<string, Record<string, unknown>>(
      body.people.map((p: { userId: string }) => [p.userId, p as Record<string, unknown>] as [string, Record<string, unknown>]),
    )
    expect(body.people).toHaveLength(3)

    const ana = byUser.get('user-1')!
    expect(ana.name).toBe('Ana Admin')
    expect(ana.role).toBe('org_admin')
    expect(ana.functions).toEqual([])
    // Punto de partida para quien no tiene nada cargado, no una autorización.
    expect(ana.suggestedFunctions).toEqual(['operations_director', 'platform_admin'])
    expect(ana.isSelf).toBe(true)

    const beto = byUser.get('user-2')!
    expect(beto.functions).toEqual(['investigator'])
    expect(beto.suggestedFunctions).toEqual([]) // ya tiene funciones: no se sugiere nada
    expect(beto.studies).toEqual([{ studyId: 'study-1', studyLabel: 'PI', expiresAt: null }])
    expect(beto.isSelf).toBe(false)

    // M15: escribió evoluciones y no tiene la función Investigador.
    const carla = byUser.get('user-3')!
    expect(carla.authorsWithoutInvestigator).toBe(true)
    expect(ana.authorsWithoutInvestigator).toBe(false)
    expect(beto.authorsWithoutInvestigator).toBe(false)
  })

  it('M15 no marca a quien tiene la función aunque no haya escrito evoluciones', async () => {
    fx.evolutionRows = []
    const body = await (await GET()).json()
    expect(body.people.every((p: { authorsWithoutInvestigator: boolean }) => !p.authorsWithoutInvestigator)).toBe(true)
  })

  it('el tope de paginación de Clerk se informa, no se oculta', async () => {
    fx.clerkTotalCount = 999
    const body = await (await GET()).json()
    expect(body.truncated).toBe(true)
  })
})
