import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ loadOrgIntegrations: vi.fn(), fetchModuleSummary: vi.fn() }))

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('../org-integrations', () => ({ loadOrgIntegrations: mocks.loadOrgIntegrations }))
vi.mock('@ichtys/integrations', async () => {
  const real = await vi.importActual<typeof import('@ichtys/integrations')>('@ichtys/integrations')
  return { ...real, fetchModuleSummary: mocks.fetchModuleSummary }
})

import { loadModuleSummary } from '../summaries'

const row = { category: 'module', integrationKey: 'queries', baseUrl: 'https://queries.centro-a.example.test', enabled: true, simulated: false }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchModuleSummary.mockResolvedValue({ module: 'queries', status: 'ok', summary: null, fetchedAt: 'x' })
})

describe('loadModuleSummary — la URL sale de la organización', () => {
  it('pide el resumen a la URL del centro', async () => {
    mocks.loadOrgIntegrations.mockResolvedValue([row])
    await loadModuleSummary('queries', 'user_1', 'org-a')
    expect(mocks.loadOrgIntegrations).toHaveBeenCalledWith('org-a')
    expect(mocks.fetchModuleSummary).toHaveBeenCalledWith('queries', { userId: 'user_1', orgId: 'org-a', baseUrl: 'https://queries.centro-a.example.test' })
  })

  it('un centro sin ese módulo pasa null: nunca cae en la URL de la instalación', async () => {
    mocks.loadOrgIntegrations.mockResolvedValue([])
    await loadModuleSummary('queries', 'user_1', 'org-b')
    expect(mocks.fetchModuleSummary).toHaveBeenCalledWith('queries', { userId: 'user_1', orgId: 'org-b', baseUrl: null })
  })

  it('si la configuración no se puede leer, el módulo figura sin conectar y la página no se cae', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.loadOrgIntegrations.mockRejectedValue(new Error('relation does not exist'))
    await expect(loadModuleSummary('queries', 'user_1', 'org-a')).resolves.toBeDefined()
    expect(mocks.fetchModuleSummary).toHaveBeenCalledWith('queries', { userId: 'user_1', orgId: 'org-a', baseUrl: null })
    error.mockRestore()
  })
})
