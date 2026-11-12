import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  organizationsFindFirst: vi.fn(),
  subjectsFindFirst: vi.fn(),
  studiesFindFirst: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
  clerkClient: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: {
      organizations: { findFirst: mocks.organizationsFindFirst },
      subjects: { findFirst: mocks.subjectsFindFirst },
      studies: { findFirst: mocks.studiesFindFirst },
    },
  },
  organizations: { clerkOrgId: 'organizations.clerkOrgId' },
  studies: { id: 'studies.id', organizationId: 'studies.organizationId' },
  subjects: { id: 'subjects.id', organizationId: 'subjects.organizationId' },
}))

import { validateSubjectAccess } from '../phi-access'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222'
const STUDY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STUDY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({
    userId: 'user_ficticio',
    orgId: 'org_clerk_ficticia',
    orgRole: 'org:site_coordinator',
  })
  mocks.organizationsFindFirst.mockResolvedValue({ id: ORG_ID, accessMode: 'open' })
  mocks.subjectsFindFirst.mockResolvedValue({
    id: SUBJECT_ID,
    organizationId: ORG_ID,
    studyId: STUDY_B,
    subjectCode: 'FIC-001',
    status: 'screening',
  })
  mocks.studiesFindFirst.mockResolvedValue({
    id: STUDY_B,
    organizationId: ORG_ID,
    name: 'Protocolo ficticio',
  })
})

describe('validateSubjectAccess — el estudio de la URL (S4)', () => {
  it('responde 404 si el sujeto pertenece a otro estudio de la misma org', async () => {
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_A)).rejects.toMatchObject({ status: 404 })
    expect(mocks.studiesFindFirst).not.toHaveBeenCalled()
  })

  it('sigue cuando el estudio de la URL es el del sujeto', async () => {
    const access = await validateSubjectAccess(SUBJECT_ID, STUDY_B)
    expect(access.subject.id).toBe(SUBJECT_ID)
    expect(access.study.id).toBe(STUDY_B)
  })

  it('sin el estudio de la URL no abre el sujeto', async () => {
    await expect(validateSubjectAccess(SUBJECT_ID, undefined as unknown as string)).rejects.toMatchObject({
      status: 404,
    })
    expect(mocks.studiesFindFirst).not.toHaveBeenCalled()
    expect(mocks.subjectsFindFirst).not.toHaveBeenCalled()
  })
})
