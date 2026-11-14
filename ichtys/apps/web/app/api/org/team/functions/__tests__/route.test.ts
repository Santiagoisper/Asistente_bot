/**
 * POST y DELETE /api/org/team/functions — asignar y quitar funciones
 * (docs/decisions/study-membership.md: M11 a M14, regla 7 y R3).
 *
 * La autorización corre de punta a punta (Clerk, modo, funciones reales);
 * la base es el fixture. El límite de tamaño del cuerpo lo prueba
 * lib/api/__tests__/body-limit.test.ts para todas las rutas juntas.
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

import { DELETE, POST } from '../route'

/** POST/DELETE comparten el mismo cuerpo; esto es solo un atajo legible. */
const grant = (body: unknown) => POST(new Request('https://x.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const revoke = (body: unknown) => DELETE(new Request('https://x.test', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

const activeFunction = (userId: string, functionKey: string) => ({
  id: `mf-${userId}-${functionKey}`,
  organizationId: 'org-1',
  userId,
  functionKey,
  grantedBy: 'user-1',
  grantedAt: new Date('2026-11-01'),
  revokedAt: null,
  revokedBy: null,
})

beforeEach(() => {
  resetFixture()
})

describe('POST /api/org/team/functions — autorización', () => {
  it('sin sesión: 401', async () => {
    fx.auth = { userId: null, orgId: null, orgRole: null }
    expect((await grant({ userId: 'user-2', functionKey: 'investigator' })).status).toBe(401)
    expect(fx.memberFunctionRows).toHaveLength(0)
  })

  it('modo open: study_admin no asigna funciones; es cosa del administrador de la organización', async () => {
    fx.auth = { userId: 'user-3', orgId: 'org_clerk_1', orgRole: 'org:study_admin' }
    expect((await grant({ userId: 'user-2', functionKey: 'investigator' })).status).toBe(403)
    expect(fx.memberFunctionRows).toHaveLength(0)
  })

  it('modo enforced: un rol alto sin la función de administración tampoco', async () => {
    fx.org.accessMode = 'enforced'
    fx.memberFunctionRows = [activeFunction('user-2', 'investigator')]
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:principal_investigator' }
    expect((await grant({ userId: 'user-3', functionKey: 'study_coordinator' })).status).toBe(403)
  })

  it('modo enforced: Operaciones y plataforma asignan; el administrador de la organización, siempre (M14)', async () => {
    fx.org.accessMode = 'enforced'
    fx.memberFunctionRows = [activeFunction('user-2', 'operations_director')]
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:read_only_monitor' }
    expect((await grant({ userId: 'user-3', functionKey: 'lab_assistant' })).status).toBe(201)

    fx.memberFunctionRows = [activeFunction('user-2', 'platform_admin')]
    expect((await grant({ userId: 'user-3', functionKey: 'crf_assistant' })).status).toBe(201)

    // org:admin sin ninguna función cargada: loadAccessSubject inyecta platform_admin.
    fx.memberFunctionRows = []
    fx.auth = { userId: 'user-1', orgId: 'org_clerk_1', orgRole: 'org:admin' }
    expect((await grant({ userId: 'user-3', functionKey: 'regulatory_assistant' })).status).toBe(201)
  })
})

describe('POST /api/org/team/functions — la asignación', () => {
  it('asigna la función y la registra en la misma transacción (regla 7, R3)', async () => {
    const res = await grant({ userId: 'user-2', functionKey: 'investigator' })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ changed: true, selfAssigned: false })
    expect(fx.transactions).toBe(1)

    const [row] = fx.memberFunctionRows
    expect(row).toMatchObject({ organizationId: 'org-1', userId: 'user-2', functionKey: 'investigator', grantedBy: 'user-1' })
    // La base la crearía con revoked_at null; el fake no completa defaults.
    expect(row?.revokedAt ?? null).toBeNull()

    expect(fx.audits).toHaveLength(1)
    expect(fx.audits[0]).toMatchObject({
      via: 'tx',
      values: {
        action: 'access.function.grant',
        organizationId: 'org-1',
        userId: 'user-1',
        resourceType: 'member_function',
        metadata: { memberUserId: 'user-2', functionKey: 'investigator', selfAssigned: false, changed: true, mode: 'open' },
      },
    })
  })

  it('ya la tenía: no duplica la fila, no es error, y el intento queda registrado', async () => {
    fx.memberFunctionRows = [activeFunction('user-2', 'investigator')]
    const res = await grant({ userId: 'user-2', functionKey: 'investigator' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changed: false, selfAssigned: false })
    expect(fx.memberFunctionRows).toHaveLength(1) // una fila vigente por persona y función
    expect(fx.audits[0]?.values.metadata).toMatchObject({ changed: false })
  })

  it('M13: asignársela a uno mismo se permite y queda marcado', async () => {
    const res = await grant({ userId: 'user-1', functionKey: 'platform_admin' })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ changed: true, selfAssigned: true })
    expect(fx.audits[0]?.values.metadata).toMatchObject({ memberUserId: 'user-1', selfAssigned: true })
  })

  it('la función no se asigna a un identificador ajeno a la organización: 404', async () => {
    const res = await grant({ userId: 'user-99', functionKey: 'investigator' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_a_member' })
    expect(fx.transactions).toBe(0)
    expect(fx.memberFunctionRows).toHaveLength(0)
  })

  it('entrada inválida: 400 sin abrir transacción', async () => {
    for (const body of [
      { userId: 'user-2', functionKey: 'cacique' }, // la lista es cerrada
      { userId: 'user-2', functionKey: 'investigator', extra: 1 }, // .strict()
      { userId: '', functionKey: 'investigator' },
      { functionKey: 'investigator' },
    ]) {
      const res = await grant(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_input' })
    }
    expect(fx.transactions).toBe(0)
  })

  it('R3: si el registro no se puede escribir, la función no queda asignada', async () => {
    fx.failAudit = true
    const res = await grant({ userId: 'user-2', functionKey: 'investigator' })
    expect(res.status).toBe(500)
    expect(fx.memberFunctionRows).toHaveLength(0)
    expect(fx.audits).toHaveLength(0)
  })
})

describe('DELETE /api/org/team/functions — la baja', () => {
  it('marca la baja sin borrar la fila, y la registra', async () => {
    fx.memberFunctionRows = [activeFunction('user-2', 'investigator')]
    const res = await revoke({ userId: 'user-2', functionKey: 'investigator' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changed: true })
    expect(fx.memberFunctionRows).toHaveLength(1) // la historia se conserva
    expect(fx.memberFunctionRows[0]).toMatchObject({ revokedAt: expect.any(Date), revokedBy: 'user-1' })

    expect(fx.audits).toHaveLength(1)
    expect(fx.audits[0]).toMatchObject({
      via: 'tx',
      values: {
        action: 'access.function.revoke',
        metadata: { memberUserId: 'user-2', functionKey: 'investigator', selfRevoked: false, changed: true, mode: 'open' },
      },
    })
  })

  it('no la tenía: changed false y registro del intento', async () => {
    const res = await revoke({ userId: 'user-2', functionKey: 'investigator' })
    expect(await res.json()).toEqual({ changed: false })
    expect(fx.audits[0]?.values.metadata).toMatchObject({ changed: false })
  })

  it('la baja de quien ya se fue de la organización tiene que poder hacerse', async () => {
    // user-9 ya no es miembro en el proveedor de identidad pero su función
    // sigue vigente: es justamente lo que la pantalla lista para dar de baja.
    fx.memberFunctionRows = [activeFunction('user-9', 'monitor')]
    const res = await revoke({ userId: 'user-9', functionKey: 'monitor' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changed: true })
  })

  it('quitarse la función a uno mismo queda marcado', async () => {
    fx.memberFunctionRows = [activeFunction('user-1', 'platform_admin')]
    await revoke({ userId: 'user-1', functionKey: 'platform_admin' })
    expect(fx.audits[0]?.values.metadata).toMatchObject({ selfRevoked: true })
  })

  it('R3: si el registro falla, la baja se revierte', async () => {
    fx.memberFunctionRows = [activeFunction('user-2', 'investigator')]
    fx.failAudit = true
    const res = await revoke({ userId: 'user-2', functionKey: 'investigator' })
    expect(res.status).toBe(500)
    expect(fx.memberFunctionRows[0]).toMatchObject({ revokedAt: null })
  })
})
