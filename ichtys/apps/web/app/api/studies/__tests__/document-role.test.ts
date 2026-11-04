import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveOrProvisionOrganization: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))

vi.mock('@ichtys/auth', async () => {
  const roles = await vi.importActual<typeof import('@ichtys/auth/roles')>('@ichtys/auth/roles')
  return {
    canManageDocuments: roles.canManageDocuments,
    normalizeRole: roles.normalizeRole,
    resolveOrProvisionOrganization: mocks.resolveOrProvisionOrganization,
    handleApiError: () => new Response('Internal Server Error', { status: 500 }),
  }
})

vi.mock('@ichtys/db', () => ({
  db: { insert: (...args: unknown[]) => mocks.insert(...args) },
  studies: { id: 'studies.id' },
}))

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
  mocks.resolveOrProvisionOrganization.mockResolvedValue({ id: 'org-interna' })
  mocks.insert.mockReturnValue({
    values: () => ({ returning: async () => [STUDY] }),
  })
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

  it('deja crear el estudio a un coordinador de sede', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:site_coordinator',
    })

    const res = await POST(createRequest())

    expect(res.status).toBe(201)
    expect(mocks.insert).toHaveBeenCalledTimes(1)
  })
})
