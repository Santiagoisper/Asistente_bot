import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findOrg: vi.fn(),
  searchOs: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@ichtys/auth', () => ({
  canAccessPhiData: (role: string) => role !== 'read_only_monitor',
  normalizeRole: (orgRole: string | null | undefined) => (orgRole ? orgRole.replace(/^org:/, '') : 'read_only_monitor'),
  handleApiError: () => new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('@ichtys/db', () => ({
  db: { query: { organizations: { findFirst: mocks.findOrg } } },
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
  mocks.findOrg.mockResolvedValue({ id: 'org-interna-1' })
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
    expect(mocks.searchOs).toHaveBeenCalledWith('org-interna-1', 'EST-201', { includeSubjects: true })
  })

  it('un monitor de solo lectura no busca sujetos', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: 'org:read_only_monitor' })
    await GET(url('SUJ-10'))
    expect(mocks.searchOs).toHaveBeenCalledWith('org-interna-1', 'SUJ-10', { includeSubjects: false })
  })

  it('con el interruptor apagado en producción: 404', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_OS
    expect((await GET(url('EST'))).status).toBe(404)
    expect(mocks.auth).not.toHaveBeenCalled()
  })
})
