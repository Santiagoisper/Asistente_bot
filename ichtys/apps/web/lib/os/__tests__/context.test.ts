import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  resolveOrProvisionOrganization: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth, currentUser: mocks.currentUser }))
vi.mock('@ichtys/auth', async () => {
  const actual = await vi.importActual<typeof import('@ichtys/auth')>('@ichtys/auth')
  return { ...actual, resolveOrProvisionOrganization: mocks.resolveOrProvisionOrganization }
})

import { getOsContext } from '../context'

describe('contexto de las pantallas del OS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sin sesión o sin organización activa: null, y no se crea nada', async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null })
    expect(await getOsContext()).toBeNull()
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: null, orgRole: null })
    expect(await getOsContext()).toBeNull()
    expect(mocks.resolveOrProvisionOrganization).not.toHaveBeenCalled()
  })

  it('una organización recién creada entra desde la primera pantalla: se da de alta sola', async () => {
    // Antes solo se daba de alta al pasar por Protocolos; Inicio, Agenda y Laboratorios
    // le decían «Elegí una organización» a alguien que ya tenía una activa.
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_nueva', orgRole: 'org:admin' })
    mocks.resolveOrProvisionOrganization.mockResolvedValue({ id: 'org-interna-1', clerkOrgId: 'org_clerk_nueva', name: 'Centro nuevo', accessMode: 'open' })
    const ctx = await getOsContext()
    expect(mocks.resolveOrProvisionOrganization).toHaveBeenCalledWith('org_clerk_nueva')
    expect(ctx).toMatchObject({ userId: 'user_1', orgId: 'org-interna-1', role: 'org_admin', canAdministerOrg: true })
  })

  it('la organización sale del token, y el rol se normaliza cerrado', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_2', orgId: 'org_clerk_a', orgRole: 'org:rol_desconocido' })
    mocks.resolveOrProvisionOrganization.mockResolvedValue({ id: 'org-a', clerkOrgId: 'org_clerk_a', name: 'A', accessMode: 'open' })
    const ctx = await getOsContext()
    expect(ctx?.orgId).toBe('org-a')
    expect(ctx?.canAdministerOrg).toBe(false)
    expect(ctx?.canSeeSubjects).toBe(false)
  })

  it('si el alta no se pudo hacer: null, las pantallas muestran el estado vacío', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_x', orgRole: 'org:admin' })
    mocks.resolveOrProvisionOrganization.mockResolvedValue(null)
    expect(await getOsContext()).toBeNull()
  })
})
