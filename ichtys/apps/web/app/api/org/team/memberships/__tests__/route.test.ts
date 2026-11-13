/**
 * POST y DELETE /api/org/team/memberships — dar, cambiar y quitar el acceso a
 * un estudio (docs/decisions/study-membership.md: M4/M18, M10 a M13, reglas 5
 * y 7, R3).
 *
 * La autorización corre de punta a punta (Clerk, modo, funciones, membresía);
 * la base es el fixture. `validateStudyAccess` exige que QUIEN LLAMA entre al
 * estudio y tenga `access.manage_study`: en modo `enforced` eso son dos ejes
 * distintos, y esta suite los recorre por separado.
 *
 * El límite de tamaño del cuerpo lo prueba lib/api/__tests__/body-limit.test.ts
 * para todas las rutas juntas.
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
// packages/auth llama a `auth()` desde su propia copia de '@clerk/nextjs/server',
// que el mock de arriba no alcanza a písar (resuelve a otro subpath). En vez de
// burlar validateStudyAccess entero — y perder de punta a punta el open/enforced
// que esta suite tiene que probar —, se reemplaza solo ese validador por el mismo
// contrato con la sesión del fixture; la política (loadAccessSubject, allows,
// canEnterStudy) es la real del paquete, y AccessError/handleApiError quedan
// intactos, así que la traducción 401/403/404 también corre de verdad.
vi.mock('@ichtys/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ichtys/auth')>()
  const { fx } = await import('../../../../../../lib/access/__tests__/access-db-fixture')
  const validateStudyAccess: typeof actual.validateStudyAccess = async (studyId, requiredRole, requiredCapability) => {
    const { userId, orgId: clerkOrgId, orgRole } = fx.auth
    if (!userId || !clerkOrgId) throw new actual.AccessError('Unauthorized', 401)

    const org = await actual.resolveOrProvisionOrganization(clerkOrgId)
    if (!org) throw new actual.AccessError('Organization not found', 403)

    const study = fx.studyRows.find((row) => row.id === studyId && row.organizationId === org.id)
    if (!study) throw new actual.AccessError('Study not found or access denied', 404)

    const role = actual.normalizeRole(orgRole)
    const access = await actual.loadAccessSubject({ org, userId, role })

    if (!actual.allows(access, 'study.read', () => true)) {
      throw new actual.AccessError('Study not found or access denied', 404)
    }
    if (!(await actual.canEnterStudy({ access, orgId: org.id, studyId: study.id as string, userId }))) {
      throw new actual.AccessError('Study not found or access denied', 404)
    }

    if (requiredRole) {
      const satisfied =
        access.mode === 'open'
          ? actual.roleSatisfies(role, requiredRole)
          : requiredCapability !== undefined && actual.allows(access, requiredCapability, () => true)
      if (!satisfied) throw new actual.AccessError('Insufficient role', 403)
    }

    return { userId, orgId: org.id, study: study as unknown as StudyAccessContext['study'], role, access }
  }
  return { ...actual, validateStudyAccess }
})

import type { StudyAccessContext } from '@ichtys/auth'
import { DELETE, POST } from '../route'

/** POST/DELETE comparten el mismo cuerpo; esto es solo un atajo legible. */
const add = (body: unknown) => POST(new Request('https://x.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const remove = (body: unknown) => DELETE(new Request('https://x.test', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

// El esquema de entrada exige UUID para el estudio.
const STUDY = '11111111-1111-4111-8111-111111111111'
const STUDY_OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const STUDY_MISSING = '33333333-3333-4333-8333-333333333333'

const DAY = 24 * 60 * 60 * 1000
const isoIn = (days: number): string => new Date(Date.now() + days * DAY).toISOString()

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

const activeMembership = (userId: string, studyId: string = STUDY, expiresAt: Date | null = null) => ({
  id: `sm-${userId}-${studyId}`,
  organizationId: 'org-1',
  studyId,
  userId,
  studyLabel: null,
  expiresAt,
  createdBy: 'user-1',
  revokedAt: null,
  revokedBy: null,
})

beforeEach(() => {
  resetFixture()
  // Un estudio propio y uno de otra organización: la base del actor nunca
  // matchea el segundo, y la respuesta tiene que ser la misma que para uno
  // inexistente (regla 5).
  fx.studyRows = [
    { id: STUDY, organizationId: 'org-1', name: 'Metabólica' },
    { id: STUDY_OTHER_ORG, organizationId: 'org-2', name: 'Ajena' },
  ]
})

describe('POST /api/org/team/memberships — autorización', () => {
  it('sin sesión: 401', async () => {
    fx.auth = { userId: null, orgId: null, orgRole: null }
    expect((await add({ userId: 'user-2', studyId: STUDY })).status).toBe(401)
    expect(fx.membershipRows).toHaveLength(0)
  })

  it('entrada inválida: 400 sin abrir transacción', async () => {
    for (const body of [
      { userId: 'user-2', studyId: 'study-1' }, // el estudio es un UUID
      { userId: 'user-2', studyId: STUDY, extra: 1 }, // .strict()
      { userId: '', studyId: STUDY },
      { userId: 'user-2' },
    ]) {
      const res = await add(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_input' })
    }
    expect(fx.transactions).toBe(0)
  })

  it('estudio inexistente: 404, y de otra organización exactamente lo mismo (regla 5)', async () => {
    const missing = await add({ userId: 'user-2', studyId: STUDY_MISSING })
    const other = await add({ userId: 'user-2', studyId: STUDY_OTHER_ORG })
    // Mismo status y mismo cuerpo: no se confirma la existencia de estudios ajenos.
    expect(other.status).toBe(missing.status)
    expect(other.status).toBe(404)
    expect(await other.text()).toBe(await missing.text())
    expect(fx.transactions).toBe(0)
  })

  it('modo open: el Study Coordinator histórico da acceso; el médico no', async () => {
    fx.auth = { userId: 'user-3', orgId: 'org_clerk_1', orgRole: 'org:study_admin' }
    expect((await add({ userId: 'user-2', studyId: STUDY })).status).toBe(201)

    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:principal_investigator' }
    expect((await add({ userId: 'user-3', studyId: STUDY })).status).toBe(403)
    expect(fx.membershipRows).toHaveLength(1)
  })

  it('modo enforced: el Study Coordinator entra con membresía y administra', async () => {
    fx.org = { ...fx.org, accessMode: 'enforced' }
    fx.memberFunctionRows = [activeFunction('user-2', 'study_coordinator')]
    fx.membershipRows = [activeMembership('user-2')]
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:principal_investigator' }
    expect((await add({ userId: 'user-3', studyId: STUDY })).status).toBe(201)
  })

  it('modo enforced: sin membresía en el estudio, el mismo coordinador recibe el 404 de siempre', async () => {
    // Ni el rol ni la función alcanzan: el alcance es la membresía (paso 3).
    fx.org = { ...fx.org, accessMode: 'enforced' }
    fx.memberFunctionRows = [activeFunction('user-2', 'study_coordinator')]
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:principal_investigator' }
    const res = await add({ userId: 'user-3', studyId: STUDY })
    expect(res.status).toBe(404)
    expect(res.text()).not.toContain('membership')
    expect(fx.transactions).toBe(0)
  })

  it('modo enforced: monitor con membresía entra a ver pero no administra; el investigador tampoco', async () => {
    fx.org = { ...fx.org, accessMode: 'enforced' }
    fx.membershipRows = [activeMembership('user-2', STUDY, new Date(Date.now() + 30 * DAY))]

    fx.memberFunctionRows = [activeFunction('user-2', 'monitor')]
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:read_only_monitor' }
    expect((await add({ userId: 'user-3', studyId: STUDY })).status).toBe(403)

    fx.memberFunctionRows = [activeFunction('user-2', 'investigator')]
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:principal_investigator' }
    expect((await add({ userId: 'user-3', studyId: STUDY })).status).toBe(403)
  })

  it('M11: Operaciones administra todos los estudios sin membresía; plataforma no entra a ninguno (M12)', async () => {
    fx.org = { ...fx.org, accessMode: 'enforced' }
    fx.memberFunctionRows = [activeFunction('user-2', 'operations_director')]
    fx.auth = { userId: 'user-2', orgId: 'org_clerk_1', orgRole: 'org:read_only_monitor' }
    expect((await add({ userId: 'user-3', studyId: STUDY })).status).toBe(201)

    // platform_admin administra la organización pero no ve estudios: sin
    // study.read ni alcance total, la respuesta es el 404 de siempre.
    fx.memberFunctionRows = [activeFunction('user-2', 'platform_admin')]
    expect((await add({ userId: 'user-3', studyId: STUDY })).status).toBe(404)
  })

  it('la membresía no se da a un identificador ajeno a la organización: 404', async () => {
    const res = await add({ userId: 'user-99', studyId: STUDY })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_a_member' })
    expect(fx.transactions).toBe(0)
    expect(fx.membershipRows).toHaveLength(0)
  })
})

describe('POST /api/org/team/memberships — vencimiento del monitor (M4, M18)', () => {
  beforeEach(() => {
    // Beto es monitor en la organización; la membresía que se le quiere dar
    // es justamente la de monitor.
    fx.memberFunctionRows = [activeFunction('user-2', 'monitor')]
  })

  it('monitor sin fecha de vencimiento: 422 y nada escrito', async () => {
    const res = await add({ userId: 'user-2', studyId: STUDY })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'monitor_requires_expiry' })
    expect(fx.transactions).toBe(0)
    expect(fx.membershipRows).toHaveLength(0)
  })

  it('M18: aunque además tenga otra función, el monitor vence', async () => {
    fx.memberFunctionRows = [activeFunction('user-2', 'monitor'), activeFunction('user-2', 'study_coordinator')]
    const res = await add({ userId: 'user-2', studyId: STUDY })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'monitor_requires_expiry' })
  })

  it('la fecha pasada o más allá del máximo también se rechazan', async () => {
    const past = await add({ userId: 'user-2', studyId: STUDY, expiresAt: isoIn(-1) })
    expect(past.status).toBe(422)
    expect(await past.json()).toEqual({ error: 'expiry_in_past' })

    const far = await add({ userId: 'user-2', studyId: STUDY, expiresAt: isoIn(366) })
    expect(far.status).toBe(422)
    expect(await far.json()).toEqual({ error: 'monitor_expiry_too_far' })
    expect(fx.membershipRows).toHaveLength(0)
  })

  it('precisión M4: sin ser monitor, una fecha cargada se valida igual (nada de plazos eternos con etiqueta)', async () => {
    // user-3 no tiene ninguna función: no necesita fecha, pero si la carga…
    const far = await add({ userId: 'user-3', studyId: STUDY, expiresAt: isoIn(366) })
    expect(far.status).toBe(422)
    expect(await far.json()).toEqual({ error: 'monitor_expiry_too_far' })

    const ok = await add({ userId: 'user-3', studyId: STUDY, expiresAt: isoIn(30) })
    expect(ok.status).toBe(201)
  })

  it('monitor con fecha dentro del máximo: se concede y la fecha queda en la fila', async () => {
    const expiresAt = isoIn(30) // una sola lectura de Date.now(): la aserción compara el mismo instante
    const res = await add({ userId: 'user-2', studyId: STUDY, expiresAt })
    expect(res.status).toBe(201)
    expect(fx.membershipRows).toHaveLength(1)
    expect(fx.membershipRows[0]?.expiresAt).toEqual(new Date(expiresAt))
    expect(fx.audits[0]?.values.metadata).toMatchObject({ hasExpiry: true })
  })
})

describe('POST /api/org/team/memberships — la membresía', () => {
  it('concede el acceso y lo registra en la misma transacción (regla 7, R3)', async () => {
    const res = await add({ userId: 'user-2', studyId: STUDY, studyLabel: 'Sub-PI' })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ outcome: 'granted' })
    expect(fx.transactions).toBe(1)

    expect(fx.membershipRows).toHaveLength(1)
    expect(fx.membershipRows[0]).toMatchObject({
      organizationId: 'org-1',
      studyId: STUDY,
      userId: 'user-2',
      studyLabel: 'Sub-PI',
      createdBy: 'user-1',
    })

    expect(fx.audits).toHaveLength(1)
    expect(fx.audits[0]).toMatchObject({
      via: 'tx',
      values: {
        action: 'access.membership.grant',
        organizationId: 'org-1',
        studyId: STUDY,
        userId: 'user-1',
        resourceType: 'study_membership',
        resourceId: STUDY,
        metadata: { memberUserId: 'user-2', selfAssigned: false, hasExpiry: false, mode: 'open' },
      },
    })
  })

  it('ya tenía acceso: se actualiza etiqueta y vencimiento, y se registra como cambio', async () => {
    fx.membershipRows = [activeMembership('user-2')]
    const res = await add({ userId: 'user-2', studyId: STUDY, studyLabel: 'PI' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ outcome: 'updated' })
    expect(fx.membershipRows).toHaveLength(1) // no se duplica
    expect(fx.membershipRows[0]).toMatchObject({ studyLabel: 'PI', expiresAt: null })
    expect(fx.audits[0]?.values.action).toBe('access.membership.update')
  })

  it('una membresía dada de baja no se actualiza: se concede una nueva', async () => {
    fx.membershipRows = [{ ...activeMembership('user-2'), revokedAt: new Date('2026-11-01'), revokedBy: 'user-1' }]
    const res = await add({ userId: 'user-2', studyId: STUDY })
    expect(await res.json()).toEqual({ outcome: 'granted' })
    expect(fx.membershipRows).toHaveLength(2) // la historia se conserva
  })

  it('M13: dársela a uno mismo se permite y queda marcado', async () => {
    const res = await add({ userId: 'user-1', studyId: STUDY })
    expect(res.status).toBe(201)
    expect(fx.audits[0]?.values.metadata).toMatchObject({ memberUserId: 'user-1', selfAssigned: true })
  })

  it('R3: si el registro no se puede escribir, la membresía no queda', async () => {
    fx.failAudit = true
    const res = await add({ userId: 'user-2', studyId: STUDY })
    expect(res.status).toBe(500)
    expect(fx.membershipRows).toHaveLength(0)
    expect(fx.audits).toHaveLength(0)
  })
})

describe('DELETE /api/org/team/memberships — la baja', () => {
  it('marca la baja sin borrar la fila, y la registra', async () => {
    fx.membershipRows = [activeMembership('user-2')]
    const res = await remove({ userId: 'user-2', studyId: STUDY })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changed: true })
    expect(fx.membershipRows).toHaveLength(1) // la historia se conserva
    expect(fx.membershipRows[0]).toMatchObject({ revokedAt: expect.any(Date), revokedBy: 'user-1' })

    expect(fx.audits).toHaveLength(1)
    expect(fx.audits[0]).toMatchObject({
      via: 'tx',
      values: {
        action: 'access.membership.revoke',
        studyId: STUDY,
        userId: 'user-1',
        metadata: { memberUserId: 'user-2', selfRevoked: false, changed: true, mode: 'open' },
      },
    })
  })

  it('sin membresía vigente: changed false y registro del intento', async () => {
    const res = await remove({ userId: 'user-2', studyId: STUDY })
    expect(await res.json()).toEqual({ changed: false })
    expect(fx.audits[0]?.values.metadata).toMatchObject({ changed: false })
  })

  it('entrada inválida: 400 sin abrir transacción', async () => {
    const res = await remove({ userId: 'user-2', studyId: 'study-1' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
    expect(fx.transactions).toBe(0)
  })

  it('R3: si el registro falla, la baja se revierte', async () => {
    fx.membershipRows = [activeMembership('user-2')]
    fx.failAudit = true
    const res = await remove({ userId: 'user-2', studyId: STUDY })
    expect(res.status).toBe(500)
    expect(fx.membershipRows[0]).toMatchObject({ revokedAt: null })
  })
})
