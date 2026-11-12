import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findOrg: vi.fn(),
  functionRows: vi.fn(),
  membershipRows: vi.fn(),
  searchOs: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@ichtys/auth', () => ({
  canAccessPhiData: (role: string) => role !== 'read_only_monitor',
  normalizeRole: (orgRole: string | null | undefined) => (orgRole ? orgRole.replace(/^org:/, '') : 'read_only_monitor'),
  handleApiError: () => new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('@ichtys/db', () => ({
  db: {
    query: { organizations: { findFirst: mocks.findOrg } },
    // Dos consultas pasan por `select`: funciones y membresías. Se distinguen por tabla.
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: table.__table === 'study_memberships' ? mocks.membershipRows : mocks.functionRows,
      }),
    }),
  },
  memberFunctions: { functionKey: 'mf.function_key', organizationId: 'mf.organization_id', userId: 'mf.user_id', revokedAt: 'mf.revoked_at' },
  studyMemberships: {
    __table: 'study_memberships',
    studyId: 'sm.study_id',
    organizationId: 'sm.organization_id',
    userId: 'sm.user_id',
    revokedAt: 'sm.revoked_at',
    expiresAt: 'sm.expires_at',
  },
  eq: (...args: unknown[]) => args,
  organizations: { clerkOrgId: 'clerk_org_id' },
}))
vi.mock('../../../../lib/os/search', () => ({ searchOs: mocks.searchOs }))

import { GET } from '../route'

const url = (q: string) => new Request(`https://os.example.test/api/search?q=${encodeURIComponent(q)}`)
const savedEnv = { vercel: process.env.VERCEL_ENV, os: process.env.ALPHI_OS }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VERCEL_ENV = 'preview'
  mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: 'org:site_coordinator' })
  mocks.findOrg.mockResolvedValue({ id: 'org-interna-1', accessMode: 'open' })
  mocks.functionRows.mockResolvedValue([])
  mocks.membershipRows.mockResolvedValue([])
  mocks.searchOs.mockResolvedValue({ studies: [{ id: 's1', label: 'EST-201', detail: 'Estudio', href: '/studies/s1/chat' }], subjects: [] })
})

afterEach(() => {
  if (savedEnv.vercel === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = savedEnv.vercel
  if (savedEnv.os === undefined) delete process.env.ALPHI_OS
  else process.env.ALPHI_OS = savedEnv.os
})

describe('GET /api/search', () => {
  it('sin sesión: 401 y no toca la base', async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null })
    const res = await GET(url('EST'))
    expect(res.status).toBe(401)
    expect(mocks.findOrg).not.toHaveBeenCalled()
    expect(mocks.searchOs).not.toHaveBeenCalled()
  })

  it('con sesión pero sin organización activa: 401', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: null, orgRole: null })
    expect((await GET(url('EST'))).status).toBe(401)
    expect(mocks.searchOs).not.toHaveBeenCalled()
  })

  it('texto de menos de 2 caracteres: listas vacías sin consultar', async () => {
    const res = await GET(url(' a '))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ studies: [], subjects: [] })
    expect(mocks.findOrg).not.toHaveBeenCalled()
    expect(mocks.searchOs).not.toHaveBeenCalled()
  })

  it('organización que no existe en la base: listas vacías', async () => {
    mocks.findOrg.mockResolvedValue(undefined)
    const res = await GET(url('EST-201'))
    expect(await res.json()).toEqual({ studies: [], subjects: [] })
    expect(mocks.searchOs).not.toHaveBeenCalled()
  })

  it('busca con el id interno de la organización del token, no con nada del pedido', async () => {
    const res = await GET(new Request('https://os.example.test/api/search?q=EST-201&orgId=org-ajena&organization_id=org-ajena'))
    expect(res.status).toBe(200)
    expect(mocks.searchOs).toHaveBeenCalledWith('org-interna-1', 'EST-201', { includeSubjects: true, scope: { kind: 'all' } })
  })

  it('un monitor de solo lectura no busca sujetos', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: 'org:read_only_monitor' })
    await GET(url('SUJ-10'))
    expect(mocks.searchOs).toHaveBeenCalledWith('org-interna-1', 'SUJ-10', { includeSubjects: false, scope: { kind: 'all' } })
  })

  it('con el interruptor apagado en producción: 404', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_OS
    expect((await GET(url('EST'))).status).toBe(404)
    expect(mocks.auth).not.toHaveBeenCalled()
  })
})

describe('GET /api/search — modo estricto', () => {
  const strict = (...functions: string[]) => {
    mocks.findOrg.mockResolvedValue({ id: 'org-interna-1', accessMode: 'enforced' })
    mocks.functionRows.mockResolvedValue(functions.map((functionKey) => ({ functionKey })))
  }

  it('sin una función que permita entrar a estudios, no busca nada, tenga el rol que tenga', async () => {
    strict()
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: 'org:admin' })
    const res = await GET(url('EST-201'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ studies: [], subjects: [] })
    expect(mocks.searchOs).not.toHaveBeenCalled()
  })

  it('el monitor busca estudios pero no sujetos, aunque su rol histórico viera datos clínicos', async () => {
    strict('monitor')
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: 'org:site_coordinator' })
    await GET(url('SUJ-10'))
    expect(mocks.searchOs).toHaveBeenCalledWith('org-interna-1', 'SUJ-10', { includeSubjects: false, scope: { kind: 'ids', studyIds: [] } })
  })

  it('quien tiene una función del equipo busca sujetos, aunque su rol histórico fuera de solo lectura', async () => {
    strict('lab_assistant')
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: 'org:read_only_monitor' })
    await GET(url('SUJ-10'))
    expect(mocks.searchOs).toHaveBeenCalledWith('org-interna-1', 'SUJ-10', { includeSubjects: true, scope: { kind: 'ids', studyIds: [] } })
  })

  it('el buscador recibe solo los estudios donde la persona tiene membresía vigente', async () => {
    strict('investigator')
    mocks.membershipRows.mockResolvedValue([{ studyId: 'estudio-a' }, { studyId: 'estudio-a' }, { studyId: 'estudio-b' }])
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: 'org:site_coordinator' })
    await GET(url('SUJ-10'))
    expect(mocks.searchOs).toHaveBeenCalledWith('org-interna-1', 'SUJ-10', {
      includeSubjects: true,
      scope: { kind: 'ids', studyIds: ['estudio-a', 'estudio-b'] },
    })
  })

  it('Dirección de Investigación busca en todos los estudios sin consultar membresías', async () => {
    strict('research_director')
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: 'org:read_only_monitor' })
    await GET(url('SUJ-10'))
    expect(mocks.searchOs).toHaveBeenCalledWith('org-interna-1', 'SUJ-10', { includeSubjects: true, scope: { kind: 'all' } })
    expect(mocks.membershipRows).not.toHaveBeenCalled()
  })
})
