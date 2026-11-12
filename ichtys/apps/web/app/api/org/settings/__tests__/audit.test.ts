/**
 * Cambiar el proveedor del modelo o sus claves es un cambio controlado (R6) y,
 * como toda escritura, se registra en la misma transacción (R3). Antes el
 * cambio de proveedor no dejaba ningún registro y el de claves lo escribía
 * como paso aparte.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message)
    }
  }
  return {
    AccessError: MockAccessError,
    tx: { __tx: true, insert: undefined as unknown },
    audits: [] as Array<{ via: 'tx' | 'db'; values: Record<string, unknown> }>,
    transactions: 0,
    failAudit: false,
    updateOrgRagConfig: vi.fn(),
    updateOrgLlmApiKeys: vi.fn(),
  }
})

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user-1', orgId: 'org_clerk', orgRole: 'org:admin' }) }))
vi.mock('@ichtys/auth', () => ({
  AccessError: mocks.AccessError,
  handleApiError: (err: unknown) => new Response('error', { status: err instanceof mocks.AccessError ? err.status : 500 }),
  resolveOrProvisionOrganization: async () => ({ id: 'org-1', accessMode: 'open' }),
}))
vi.mock('@ichtys/auth/access-subject', () => ({ loadAccessSubject: async () => ({}) }))
vi.mock('../../../../../lib/settings/permissions', () => ({ canChangeOrgSettings: () => true }))
vi.mock('../../../../../lib/settings/provider-guard', () => ({ isProviderChoiceSupported: () => true, mergeOrgKeys: (a: object, b: object) => ({ ...a, ...b }) }))
vi.mock('@ichtys/llm', () => ({
  AUTO_PROVIDER_CHAIN: [],
  BILLING_URLS: {},
  checkAllProviderHealth: vi.fn(),
  fetchOpenAiUsageSummary: vi.fn(),
  getDefaultProviderPreference: vi.fn(),
  isAnthropicConfigured: vi.fn(),
  isGoogleConfigured: vi.fn(),
  isGroqConfigured: vi.fn(),
  isOpenAiConfigured: vi.fn(),
  providerLabel: vi.fn(),
}))
vi.mock('@ichtys/db', () => {
  const insert = (via: 'tx' | 'db') => () => ({
    values: (values: Record<string, unknown>) => {
      if (mocks.failAudit) return Promise.reject(new Error('audit unavailable'))
      mocks.audits.push({ via, values })
      return Promise.resolve()
    },
  })
  mocks.tx.insert = insert('tx')
  return {
    auditLogs: { __name: 'audit_logs' },
    buildOrgLlmKeyStatuses: () => [],
    getOrgLlmApiKeys: async () => ({}),
    getOrgRagConfig: async () => ({ llmProvider: 'anthropic', similarityThreshold: 0.2, topK: 8 }),
    resolveLlmApiKey: () => null,
    updateOrgRagConfig: mocks.updateOrgRagConfig,
    updateOrgLlmApiKeys: mocks.updateOrgLlmApiKeys,
    db: {
      insert: insert('db'),
      transaction: async <T,>(run: (tx: unknown) => Promise<T>) => {
        mocks.transactions += 1
        return run(mocks.tx)
      },
    },
  }
})

import { PATCH } from '../route'

const patch = (body: unknown) => PATCH(new Request('https://os.example.test/api/org/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const SECRET = 'clave-ficticia-de-prueba-0001'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.audits.length = 0
  mocks.transactions = 0
  mocks.failAudit = false
})

describe('PATCH /api/org/settings — cambios con registro', () => {
  it('cambiar el proveedor del modelo deja registro en la misma transacción', async () => {
    const res = await patch({ llmProvider: 'openai', topK: 6 })

    expect(res.status).toBe(200)
    expect(mocks.transactions).toBe(1)
    expect(mocks.updateOrgRagConfig).toHaveBeenCalledWith('org-1', { llmProvider: 'openai', topK: 6 }, mocks.tx)
    expect(mocks.audits).toEqual([
      {
        via: 'tx',
        values: expect.objectContaining({
          action: 'admin.action',
          organizationId: 'org-1',
          userId: 'user-1',
          resourceType: 'organization',
          resourceId: 'org-1',
          // Valores nuevos y anteriores de lo que cambió (no son secretos): se sabe qué quedó aplicado.
          metadata: { type: 'org.rag_config.updated', fields: ['llmProvider', 'topK'], llmProvider: 'openai', values: { llmProvider: 'openai', topK: 6 }, previous: { llmProvider: 'anthropic', topK: 8 } },
        }),
      },
    ])
  })

  it('cambiar claves deja registro en la misma transacción, con el proveedor y sin la clave', async () => {
    const res = await patch({ llmApiKeys: { openai: SECRET, groq: null } })

    expect(res.status).toBe(200)
    expect(mocks.transactions).toBe(1)
    expect(mocks.updateOrgLlmApiKeys).toHaveBeenCalledWith('org-1', { openai: SECRET, groq: null }, mocks.tx)
    expect(mocks.audits).toHaveLength(1)
    // Por proveedor queda si la clave se cargó o se quitó; nunca la clave.
    expect(mocks.audits[0]).toMatchObject({ via: 'tx', values: { metadata: { type: 'org.llm_keys.updated', providers: ['openai', 'groq'], operations: { openai: 'set', groq: 'removed' } } } })
    expect(JSON.stringify(mocks.audits)).not.toContain(SECRET)
  })

  it('proveedor y claves en el mismo pedido: una sola transacción con los dos registros', async () => {
    await patch({ llmProvider: 'openai', llmApiKeys: { openai: SECRET } })

    expect(mocks.transactions).toBe(1)
    expect(mocks.audits.map((a) => (a.values.metadata as { type: string }).type)).toEqual(['org.rag_config.updated', 'org.llm_keys.updated'])
    expect(mocks.audits.every((a) => a.via === 'tx')).toBe(true)
  })

  it('sin cambios no abre transacción ni registra', async () => {
    expect((await patch({})).status).toBe(200)
    expect(mocks.transactions).toBe(0)
    expect(mocks.audits).toEqual([])
  })

  it('si el registro no se puede escribir, el pedido falla', async () => {
    mocks.failAudit = true
    expect((await patch({ llmProvider: 'openai' })).status).toBe(500)
  })
})
