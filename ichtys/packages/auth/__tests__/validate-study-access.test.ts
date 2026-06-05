import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organization, Study } from '@ichtys/db'

interface ClerkAuthState {
  userId: string | null
  orgId: string | null
  orgRole: string | null
}

interface FindFirstArgs {
  where: unknown
}

type FindFirst<T> = (args: FindFirstArgs) => Promise<T | null>

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<ClerkAuthState>>(),
  organizationsFindFirst: vi.fn<FindFirst<Organization>>(),
  studiesFindFirst: vi.fn<FindFirst<Study>>(),
  and: vi.fn((...conditions: readonly unknown[]) => ({ conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
}))

vi.mock('drizzle-orm', () => ({
  and: mocks.and,
  eq: mocks.eq,
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: {
      organizations: {
        findFirst: mocks.organizationsFindFirst,
      },
      studies: {
        findFirst: mocks.studiesFindFirst,
      },
    },
  },
  organizations: {
    clerkOrgId: 'organizations.clerkOrgId',
  },
  studies: {
    id: 'studies.id',
    organizationId: 'studies.organizationId',
  },
}))

import { validateStudyAccess } from '../validate-study-access'
import { POST as chatPost } from '../../../apps/web/app/api/chat/route'

interface TenantFixture {
  userId: string
  clerkOrgId: string
  orgId: string
  studyId: string
  org: Organization
  study: Study
}

function createTenantFixture(): TenantFixture {
  const userId = crypto.randomUUID()
  const clerkOrgId = crypto.randomUUID()
  const orgId = crypto.randomUUID()
  const studyId = crypto.randomUUID()
  const createdAt = new Date()

  return {
    userId,
    clerkOrgId,
    orgId,
    studyId,
    org: {
      id: orgId,
      name: crypto.randomUUID(),
      clerkOrgId,
      createdAt,
      updatedAt: createdAt,
    },
    study: {
      id: studyId,
      organizationId: orgId,
      siteId: null,
      name: crypto.randomUUID(),
      protocolNumber: null,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
  }
}

function setActiveClerkSession(fixture: TenantFixture): void {
  mocks.auth.mockResolvedValue({
    userId: fixture.userId,
    orgId: fixture.clerkOrgId,
    orgRole: null,
  })
}

function createJsonRequest(body: object): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('validateStudyAccess tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when Clerk has no userId', async () => {
    const fixture = createTenantFixture()
    mocks.auth.mockResolvedValue({
      userId: null,
      orgId: fixture.clerkOrgId,
      orgRole: null,
    })

    await expect(validateStudyAccess(fixture.studyId)).rejects.toMatchObject({ status: 401 })
    expect(mocks.organizationsFindFirst).not.toHaveBeenCalled()
  })

  it('rejects when Clerk has no active orgId', async () => {
    const fixture = createTenantFixture()
    mocks.auth.mockResolvedValue({
      userId: fixture.userId,
      orgId: null,
      orgRole: null,
    })

    await expect(validateStudyAccess(fixture.studyId)).rejects.toMatchObject({ status: 401 })
    expect(mocks.organizationsFindFirst).not.toHaveBeenCalled()
  })

  it('rejects a study that does not belong to the active organization', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.studiesFindFirst.mockResolvedValue(null)

    await expect(validateStudyAccess(fixture.studyId)).rejects.toMatchObject({ status: 404 })
    expect(mocks.studiesFindFirst).toHaveBeenCalledOnce()
  })

  it('returns the study when it belongs to the active organization', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.studiesFindFirst.mockResolvedValue(fixture.study)

    const result = await validateStudyAccess(fixture.studyId)

    expect(result.userId).toBe(fixture.userId)
    expect(result.orgId).toBe(fixture.orgId)
    expect(result.study).toEqual(fixture.study)
  })

  it('/api/chat rejects organization_id in the body', async () => {
    const fixture = createTenantFixture()
    const response = await chatPost(
      createJsonRequest({
        studyId: fixture.studyId,
        organization_id: fixture.orgId,
        message: crypto.randomUUID(),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it('/api/chat rejects a study outside the active organization', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.studiesFindFirst.mockResolvedValue(null)

    const response = await chatPost(
      createJsonRequest({
        studyId: fixture.studyId,
        message: crypto.randomUUID(),
      }),
    )

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('Not Found')
  })
})
