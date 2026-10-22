import { describe, expect, it, vi } from 'vitest'

// checkAllProviderHealth no debe probar GLM: salió del producto (E2E
// 2026-10-22, PR #39) y una fila glm en "Probar proveedores" mostraba un
// proveedor que ya no se puede elegir (hallazgo BAJO de reviewer en #39).

const mocks = vi.hoisted(() => ({
  checkProviderHealth: vi.fn(),
}))

vi.mock('../provider-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../provider-health')>()
  return {
    ...actual,
    checkProviderHealth: mocks.checkProviderHealth,
  }
})

import { checkAllProviderHealth } from '../provider-health'

describe('checkAllProviderHealth — sin GLM', () => {
  it('prueba solo los 4 proveedores del producto, nunca glm', async () => {
    mocks.checkProviderHealth.mockImplementation(async (provider: string) => ({
      provider,
      status: 'ok' as const,
      message: null,
      modelId: null,
    }))
    const results = await checkAllProviderHealth(null)
    expect(results.map((r) => r.provider).sort()).toEqual(['anthropic', 'google', 'groq', 'openai'])
    expect(results.some((r) => r.provider === 'glm')).toBe(false)
    expect(mocks.checkProviderHealth).not.toHaveBeenCalledWith('glm', expect.anything())
  })
})
