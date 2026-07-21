import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Leakage suite — study access boundary (SECURITY.md §2, §5).
 *
 * Bloqueante para release. Verifica que validateStudyAccess():
 *  1. rechaza requests sin sesión o sin org activa (401),
 *  2. busca el study SIEMPRE filtrado por la organization_id interna
 *     resuelta desde el token de Clerk (nunca desde input del cliente),
 *  3. devuelve 404 genérico cuando el study pertenece a otra org
 *     (anti-enumeration), sin ejecutar lógica de negocio.
 */

interface ClerkAuthState {
  userId: string | null
  orgId: string | null
  orgRole: string | null
}

interface EqCondition {
  left: unknown
  right: unknown
}

interface AndCondition {
  conditions: EqCondition[]
}

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<ClerkAuthState>>(),
  clerkClient: vi.fn(),
  organizationsFindFirst: vi.fn(),
  studiesFindFirst: vi.fn<(args: { where: AndCondition }) => Promise<unknown>>(),
  insertReturning: vi.fn<() => Promise<unknown[]>>(),
  and: vi.fn((...conditions: EqCondition[]) => ({ conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
  clerkClient: mocks.clerkClient,
}))

vi.mock('drizzle-orm', () => ({
  and: mocks.and,
  eq: mocks.eq,
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: {
      organizations: { findFirst: mocks.organizationsFindFirst },
      studies: { findFirst: mocks.studiesFindFirst },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: mocks.insertReturning })),
    })),
  },
  organizations: { clerkOrgId: 'organizations.clerkOrgId' },
  studies: { id: 'studies.id', organizationId: 'studies.organizationId' },
}))

import { AccessError, validateStudyAccess } from '../../validate-study-access'

const CLERK_ORG_A = 'org_clerk_a'
const INTERNAL_ORG_A = '11111111-1111-4111-8111-111111111111'
const STUDY_OF_ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STUDY_OF_ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function eqRight(where: AndCondition, left: unknown): unknown {
  return where.conditions.find((condition) => condition.left === left)?.right
}

describe('leakage — validateStudyAccess tenant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizationsFindFirst.mockResolvedValue({
      id: INTERNAL_ORG_A,
      clerkOrgId: CLERK_ORG_A,
      name: 'Org A',
    })
  })

  it('rejects requests without a session (401) before touching the DB', async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null })

    await expect(validateStudyAccess(STUDY_OF_ORG_A)).rejects.toMatchObject({
      name: 'AccessError',
      status: 401,
    })
    expect(mocks.studiesFindFirst).not.toHaveBeenCalled()
  })

  it('rejects a session without an active organization (401)', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: null, orgRole: null })

    await expect(validateStudyAccess(STUDY_OF_ORG_A)).rejects.toMatchObject({
      status: 401,
    })
    expect(mocks.studiesFindFirst).not.toHaveBeenCalled()
  })

  it('queries the study filtered by the internal org id resolved from the token', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: CLERK_ORG_A,
      orgRole: 'org:admin',
    })
    mocks.studiesFindFirst.mockResolvedValue({
      id: STUDY_OF_ORG_A,
      organizationId: INTERNAL_ORG_A,
    })

    const context = await validateStudyAccess(STUDY_OF_ORG_A)

    const whereArg = mocks.studiesFindFirst.mock.calls[0]?.[0]?.where
    expect(whereArg).toBeDefined()
    expect(eqRight(whereArg as AndCondition, 'studies.id')).toBe(STUDY_OF_ORG_A)
    expect(eqRight(whereArg as AndCondition, 'studies.organizationId')).toBe(INTERNAL_ORG_A)
    expect(context.orgId).toBe(INTERNAL_ORG_A)
  })

  it('returns generic 404 when the study belongs to another organization', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: CLERK_ORG_A,
      orgRole: 'org:admin',
    })
    // El WHERE filtra por org A → un study de org B no matchea → findFirst: undefined.
    mocks.studiesFindFirst.mockResolvedValue(undefined)

    const rejection = expect(validateStudyAccess(STUDY_OF_ORG_B)).rejects
    await rejection.toBeInstanceOf(AccessError)
    await expect(validateStudyAccess(STUDY_OF_ORG_B)).rejects.toMatchObject({
      status: 404,
      message: 'Study not found or access denied',
    })
  })

  it('applies least privilege when the Clerk role is unknown (read_only_monitor)', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: CLERK_ORG_A,
      orgRole: 'org:hacker_role',
    })
    mocks.studiesFindFirst.mockResolvedValue({
      id: STUDY_OF_ORG_A,
      organizationId: INTERNAL_ORG_A,
    })

    await expect(validateStudyAccess(STUDY_OF_ORG_A, 'study_admin')).rejects.toMatchObject({
      status: 403,
    })
  })
})
