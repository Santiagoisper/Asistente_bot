import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted
// ---------------------------------------------------------------------------

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

  return {
    AccessError: MockAccessError,
    auth: vi.fn(),
    resolveOrProvisionOrganization: vi.fn(),
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockImplementation((err: unknown) =>
        err instanceof MockAccessError
          ? new Response('Forbidden', { status: err.status })
          : new Response('Internal Server Error', { status: 500 }),
      ),
    getQuotaStatus: vi.fn(),
    getUsageSummary: vi.fn(),
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
  microsToUsd: (micros: number) => micros / 1_000_000,
  QUOTA_WARNING_RATIO: 0.8,
}))

import { GET } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = crypto.randomUUID()
const CLERK_ORG_ID = 'org_clerk_123'
const USER_ID = crypto.randomUUID()

const PERIOD_START = new Date('2026-10-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-11-01T00:00:00.000Z')

function mockAuthed() {
  mocks.auth.mockResolvedValueOnce({ userId: USER_ID, orgId: CLERK_ORG_ID })
  mocks.resolveOrProvisionOrganization.mockResolvedValueOnce({ id: ORG_ID })
}

function makeQuota(overrides: Record<string, unknown> = {}) {
  return {
    planName: 'Profesional',
    budgetMicros: 100_000_000,
    usedMicros: 40_000_000,
    remainingMicros: 60_000_000,
    percentUsed: 40,
    state: 'ok' as const,
    ...overrides,
  }
}

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    period: { start: PERIOD_START, end: PERIOD_END },
    rows: [
      {
        kind: 'chat_answer' as const,
        keySource: 'platform' as const,
        inputTokens: 1000,
        outputTokens: 500,
        costMicros: 10_000_000,
        calls: 3,
      },
    ],
    platformTokens: 1500,
    orgKeyTokens: 0,
    totalTokens: 1500,
    platformCostMicros: 10_000_000,
    orgKeyCostMicros: 0,
    totalCostMicros: 10_000_000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/org/usage', () => {
  it('returns 401 when there is no authenticated user', async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null, orgId: null })

    const res = await GET()

    expect(res.status).toBe(401)
    expect(mocks.getQuotaStatus).not.toHaveBeenCalled()
  })

  it('returns 403 when the org cannot be resolved/provisioned', async () => {
    mocks.auth.mockResolvedValueOnce({ userId: USER_ID, orgId: CLERK_ORG_ID })
    mocks.resolveOrProvisionOrganization.mockResolvedValueOnce(null)

    const res = await GET()

    expect(res.status).toBe(403)
  })

  it('converts quota and breakdown to USD for an org within its plan', async () => {
    mockAuthed()
    mocks.getQuotaStatus.mockResolvedValueOnce(makeQuota())
    mocks.getUsageSummary.mockResolvedValueOnce(makeSummary())

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.plan).toEqual({ name: 'Profesional', budgetUsd: 100 })
    expect(body.quota).toMatchObject({ state: 'ok', usedUsd: 40, remainingUsd: 60, percentUsed: 40 })
    expect(body.breakdown).toEqual([
      {
        kind: 'chat_answer',
        label: 'Respuestas del chat',
        keySource: 'platform',
        calls: 3,
        tokens: 1500,
        costUsd: 10,
      },
    ])
    expect(body.totals).toMatchObject({ platformUsd: 10, orgKeyUsd: 0, totalUsd: 10 })
  })

  it('reports state no_quota and a null budget when the org has no plan assigned', async () => {
    mockAuthed()
    mocks.getQuotaStatus.mockResolvedValueOnce(
      makeQuota({ planName: null, budgetMicros: null, remainingMicros: null, percentUsed: null, state: 'no_quota' }),
    )
    mocks.getUsageSummary.mockResolvedValueOnce(makeSummary({ rows: [] }))

    const res = await GET()
    const body = await res.json()

    expect(body.plan).toEqual({ name: null, budgetUsd: null })
    expect(body.quota.state).toBe('no_quota')
    expect(body.quota.remainingUsd).toBeNull()
    expect(body.breakdown).toEqual([])
  })

  it('reports state exceeded when usage has passed the monthly budget', async () => {
    mockAuthed()
    mocks.getQuotaStatus.mockResolvedValueOnce(
      makeQuota({ usedMicros: 120_000_000, remainingMicros: 0, percentUsed: 100, state: 'exceeded' }),
    )
    mocks.getUsageSummary.mockResolvedValueOnce(makeSummary())

    const res = await GET()
    const body = await res.json()

    expect(body.quota.state).toBe('exceeded')
    expect(body.quota.remainingUsd).toBe(0)
  })

  it('never exposes raw organization/Clerk identifiers in the response', async () => {
    mockAuthed()
    mocks.getQuotaStatus.mockResolvedValueOnce(makeQuota())
    mocks.getUsageSummary.mockResolvedValueOnce(makeSummary())

    const res = await GET()
    const raw = await res.text()

    expect(raw).not.toContain(ORG_ID)
    expect(raw).not.toContain(CLERK_ORG_ID)
  })
})
