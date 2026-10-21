import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403 | 404,
    ) {
      super(message)
      this.name = 'AccessError'
    }
  }

  const DB_ORG_ID = crypto.randomUUID()

  return {
    AccessError: MockAccessError,
    DB_ORG_ID,
    auth: vi.fn(),
    resolveOrProvisionOrganization: vi.fn(),
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockImplementation((err: unknown) =>
        err instanceof MockAccessError
          ? new Response(err.message, { status: err.status })
          : new Response('Internal Server Error', { status: 500 }),
      ),
    getQuotaStatus: vi.fn(),
    getUsageSummary: vi.fn(),
    getUsagePeriod: vi.fn(),
  }
})

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))

vi.mock('@ichtys/auth', () => ({
  AccessError: mocks.AccessError,
  handleApiError: mocks.handleApiError,
  resolveOrProvisionOrganization: mocks.resolveOrProvisionOrganization,
}))

vi.mock('@ichtys/db', () => ({
  getQuotaStatus: mocks.getQuotaStatus,
  getUsageSummary: mocks.getUsageSummary,
  getUsagePeriod: mocks.getUsagePeriod,
  microsToUsd: (micros: number) => micros / 1_000_000,
}))

import { GET } from '../route'

const period = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') }

function signedIn(orgRole: string): void {
  mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveOrProvisionOrganization.mockResolvedValue({ id: mocks.DB_ORG_ID })
  mocks.getUsagePeriod.mockReturnValue(period)
  mocks.getQuotaStatus.mockResolvedValue({
    planName: 'Profesional',
    budgetMicros: 100_000_000,
    usedMicros: 10_000_000,
    remainingMicros: 90_000_000,
    percentUsed: 10,
    state: 'ok',
    period,
  })
  mocks.getUsageSummary.mockResolvedValue({
    period,
    rows: [],
    platformTokens: 0,
    orgKeyTokens: 0,
    totalTokens: 0,
    platformCostMicros: 0,
    orgKeyCostMicros: 0,
    totalCostMicros: 0,
  })
})

describe('GET /api/org/usage', () => {
  it('401 sin sesión u organización activa, sin tocar la base', async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null })

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mocks.getQuotaStatus).not.toHaveBeenCalled()
    expect(mocks.getUsageSummary).not.toHaveBeenCalled()
  })

  it('401 si hay usuario pero ninguna organización activa', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: null, orgRole: 'org:admin' })
    expect((await GET()).status).toBe(401)
  })

  it.each(['org:site_coordinator', 'org:principal_investigator', 'org:read_only_monitor', null, 'org:rol_desconocido'])(
    '403 para roles por debajo de study_admin (%s)',
    async (role) => {
      mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_1', orgRole: role })

      const response = await GET()

      expect(response.status).toBe(403)
      expect(mocks.getQuotaStatus).not.toHaveBeenCalled()
    },
  )

  it.each(['org:admin', 'org:org_admin', 'org:study_admin'])('200 para %s', async (role) => {
    signedIn(role)

    const response = await GET()

    expect(response.status).toBe(200)
    const body = (await response.json()) as { quota: { budgetUsd: number; usedUsd: number } }
    expect(body.quota).toMatchObject({ budgetUsd: 100, usedUsd: 10 })
  })

  it('usa el organization_id de la base resuelto desde el token de Clerk, nunca del request', async () => {
    signedIn('org:admin')

    await GET()

    expect(mocks.resolveOrProvisionOrganization).toHaveBeenCalledWith('org_clerk_1')
    expect(mocks.getQuotaStatus).toHaveBeenCalledWith(mocks.DB_ORG_ID)
    expect(mocks.getUsageSummary).toHaveBeenCalledWith(mocks.DB_ORG_ID, period)
  })

  it('no se cachea (dato privado de la organización)', async () => {
    signedIn('org:admin')
    const response = await GET()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('403 si la organización no se puede resolver', async () => {
    signedIn('org:admin')
    mocks.resolveOrProvisionOrganization.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
  })

  it('503 con aviso claro mientras la migración no esté aplicada', async () => {
    signedIn('org:admin')
    mocks.getQuotaStatus.mockRejectedValue(
      new Error('Failed query', { cause: new Error('relation "usage_events" does not exist') }),
    )

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'usage_not_enabled' })
  })

  it('503 también si falta la columna del plan', async () => {
    signedIn('org:admin')
    mocks.getQuotaStatus.mockRejectedValue(new Error('column "monthly_budget_micros" does not exist'))
    expect((await GET()).status).toBe(503)
  })

  it('cualquier otro error de la base es un 500 genérico y no se filtra el detalle', async () => {
    signedIn('org:admin')
    mocks.getQuotaStatus.mockRejectedValue(new Error('password authentication failed for user secreto'))

    const response = await GET()

    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secreto')
  })
})
