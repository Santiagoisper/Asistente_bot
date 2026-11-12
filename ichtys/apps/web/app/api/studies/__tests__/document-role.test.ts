import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveOrProvisionOrganization: vi.fn(),
  insert: vi.fn(),
  auditValues: vi.fn(),
  functionRows: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))

vi.mock('@ichtys/auth', async () => {
  const roles = await vi.importActual<typeof import('@ichtys/auth/roles')>('@ichtys/auth/roles')
  return {
    canManageDocuments: roles.canManageDocuments,
    canAdministerStudy: roles.canAdministerStudy,
    normalizeRole: roles.normalizeRole,
    resolveOrProvisionOrganization: mocks.resolveOrProvisionOrganization,
    handleApiError: () => new Response('Internal Server Error', { status: 500 }),
  }
})

vi.mock('@ichtys/db', () => {
  const studies = { id: 'studies.id' }
  const auditLogs = { id: 'audit_logs.id' }
  // La transacción de prueba no revierte nada: si el registro de auditoría
  // lanza, la ruta tiene que propagar el error y no devolver 201.
  const tx = {
    insert: (table: unknown) =>
      table === auditLogs ? { values: (row: unknown) => mocks.auditValues(row) } : mocks.insert(table),
  }
  return {
    db: {
      transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
      select: () => ({ from: () => ({ where: mocks.functionRows }) }),
    },
    memberFunctions: { functionKey: 'mf.function_key', organizationId: 'mf.organization_id', userId: 'mf.user_id', revokedAt: 'mf.revoked_at' },
    studies,
    auditLogs,
  }
})

import { POST } from '../route'

const STUDY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Protocolo ficticio',
  protocolNumber: 'FIC-001',
  status: 'active',
}

function createRequest(): Request {
  return new Request('http://localhost/api/studies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: STUDY.name, protocolNumber: STUDY.protocolNumber }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveOrProvisionOrganization.mockResolvedValue({ id: 'org-interna', accessMode: 'open' })
  mocks.insert.mockReturnValue({
    values: () => ({ returning: async () => [STUDY] }),
  })
  mocks.auditValues.mockResolvedValue(undefined)
  mocks.functionRows.mockResolvedValue([])
})

describe('POST /api/studies — gestión documental (S1)', () => {
  it.each([
    ['org:read_only_monitor', 'read_only_monitor'],
    ['org:principal_investigator', 'principal_investigator'],
  ])('rechaza a %s antes de crear el estudio', async (orgRole) => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole })

    const res = await POST(createRequest())

    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('rechaza a un coordinador de sede antes de crear el estudio', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:site_coordinator',
    })

    const res = await POST(createRequest())

    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('deja crear el estudio a un administrador del estudio', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:study_admin',
    })

    const res = await POST(createRequest())

    expect(res.status).toBe(201)
    expect(mocks.insert).toHaveBeenCalledTimes(1)
  })

  it('abrir un estudio deja registro de auditoría, sin el nombre del estudio', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole: 'org:study_admin' })

    const res = await POST(createRequest())

    expect(res.status).toBe(201)
    expect(mocks.auditValues).toHaveBeenCalledTimes(1)
    const entry = mocks.auditValues.mock.calls[0]?.[0]
    expect(entry).toMatchObject({
      action: 'study.create',
      organizationId: 'org-interna',
      studyId: STUDY.id,
      userId: 'user_1',
      resourceType: 'study',
      resourceId: STUDY.id,
    })
    expect(JSON.stringify(entry)).not.toContain(STUDY.name)
  })

  it('si el registro de auditoría falla, el alta no se informa como hecha', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole: 'org:study_admin' })
    mocks.auditValues.mockRejectedValue(new Error('falla ficticia'))

    const res = await POST(createRequest())

    expect(res.status).toBe(500)
  })

  it('un pedido rechazado no deja registro de estudio creado', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole: 'org:read_only_monitor' })

    await POST(createRequest())

    expect(mocks.auditValues).not.toHaveBeenCalled()
  })
})

describe('POST /api/studies — modo estricto', () => {
  const strict = (...functions: string[]) => {
    mocks.resolveOrProvisionOrganization.mockResolvedValue({ id: 'org-interna', accessMode: 'enforced' })
    mocks.functionRows.mockResolvedValue(functions.map((functionKey) => ({ functionKey })))
  }

  it('el administrador de la organización, sin una función que abra estudios, no crea un estudio', async () => {
    strict()
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole: 'org:admin' })

    const res = await POST(createRequest())

    expect(res.status).toBe(403)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.auditValues).not.toHaveBeenCalled()
  })

  it('un investigador no abre estudios', async () => {
    strict('investigator')
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole: 'org:admin' })
    expect((await POST(createRequest())).status).toBe(403)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('el Study Coordinator abre un estudio aunque su rol histórico no alcanzara', async () => {
    strict('study_coordinator')
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole: 'org:site_coordinator' })

    const res = await POST(createRequest())

    expect(res.status).toBe(201)
    expect(mocks.auditValues).toHaveBeenCalledTimes(1)
  })
})
