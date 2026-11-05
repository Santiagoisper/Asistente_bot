/**
 * ADR-3 §2.4 — una spec con grupos `invalid_output` es `partial` y no se
 * aprueba sin un reconocimiento explícito.
 */
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

  const tx = {
    query: { studySpecs: { findFirst: vi.fn() } },
    update: vi.fn(),
    insert: vi.fn(),
  }

  return {
    AccessError: MockAccessError,
    validateStudyAccess: vi.fn(),
    tx,
    inserted: [] as unknown[],
  }
})

vi.mock('@ichtys/auth', () => ({
  validateStudyAccess: mocks.validateStudyAccess,
  AccessError: mocks.AccessError,
}))

vi.mock('@ichtys/db', () => ({
  and: (...parts: unknown[]) => parts,
  eq: (column: unknown, value: unknown) => [column, value],
  ne: (column: unknown, value: unknown) => [column, value],
  auditLogs: {},
  studySpecs: {},
  db: {
    transaction: async (run: (tx: unknown) => Promise<void>) => run(mocks.tx),
  },
}))

vi.mock('../../../../../../../../lib/rag/spec-terminology', () => ({
  extractSpecTerminology: () => [],
}))

import { POST } from '../route'

const STUDY_ID = crypto.randomUUID()
const SPEC_ID = crypto.randomUUID()

function params() {
  return { params: Promise.resolve({ id: STUDY_ID, specId: SPEC_ID }) }
}

function spec(overrides: Record<string, unknown> = {}) {
  return {
    identification: { protocolCode: null, title: null, phase: null, sourcePages: [] },
    inclusionCriteria: [],
    exclusionCriteria: [],
    endpoints: [],
    visits: [],
    ...overrides,
  }
}

function draft(specValue: unknown) {
  return {
    id: SPEC_ID,
    version: 3,
    status: 'draft' as const,
    organizationId: 'org-1',
    studyId: STUDY_ID,
    spec: specValue,
  }
}

function approveRequest(body?: unknown): Request {
  return new Request(`http://localhost/api/studies/${STUDY_ID}/spec/${SPEC_ID}/approve`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

describe('POST approve — reconocimiento de grupos parciales (ADR-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.inserted.length = 0
    mocks.validateStudyAccess.mockResolvedValue({ userId: 'user-1', orgId: 'org-1' })
    mocks.tx.update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })
    mocks.tx.insert.mockReturnValue({
      values: vi.fn(async (value: unknown) => {
        mocks.inserted.push(value)
      }),
    })
  })

  it('una spec con grupo invalid_output responde 409 sin cuerpo y no escribe', async () => {
    mocks.tx.query.studySpecs.findFirst.mockResolvedValue(
      draft(spec({ groupOutcomes: { eligibility: { status: 'invalid_output', code: 'item_repaired' } } })),
    )

    const res = await POST(approveRequest(), params())

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'spec_incomplete',
      groups: ['eligibility'],
    })
    expect(mocks.tx.update).not.toHaveBeenCalled()
    expect(mocks.tx.insert).not.toHaveBeenCalled()
  })

  it('con acknowledgeGroups aprueba y lo deja auditado', async () => {
    mocks.tx.query.studySpecs.findFirst.mockResolvedValue(
      draft(spec({ groupOutcomes: { eligibility: { status: 'invalid_output', code: 'item_repaired' } } })),
    )

    const res = await POST(approveRequest({ acknowledgeGroups: ['eligibility'] }), params())

    expect(res.status).toBe(200)
    expect(mocks.tx.update).toHaveBeenCalledTimes(2)
    const audit = mocks.inserted[0] as { metadata?: { acknowledgedGroups?: string[] } }
    expect(audit.metadata?.acknowledgedGroups).toEqual(['eligibility'])
  })

  it('reconocer un grupo distinto no alcanza', async () => {
    mocks.tx.query.studySpecs.findFirst.mockResolvedValue(
      draft(spec({ groupOutcomes: { visits: { status: 'not_located' } } })),
    )

    const res = await POST(approveRequest({ acknowledgeGroups: ['eligibility'] }), params())

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'spec_incomplete',
      groups: ['visits'],
    })
  })

  it('una spec sin grupos parciales se aprueba como antes, sin cuerpo', async () => {
    mocks.tx.query.studySpecs.findFirst.mockResolvedValue(draft(spec()))

    const res = await POST(approveRequest(), params())

    expect(res.status).toBe(200)
    expect(mocks.tx.update).toHaveBeenCalledTimes(2)
    const audit = mocks.inserted[0] as { metadata?: { acknowledgedGroups?: string[] } }
    expect(audit.metadata?.acknowledgedGroups).toBeUndefined()
  })
})
