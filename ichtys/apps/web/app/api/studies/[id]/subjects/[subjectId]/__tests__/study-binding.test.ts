import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateSubjectAccess: vi.fn(),
  handleApiError: vi.fn((err: unknown) => {
    if (err instanceof Error && 'status' in err) {
      return new Response('Not Found', { status: (err as { status: number }).status })
    }
    return new Response('Internal Server Error', { status: 500 })
  }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: mocks.handleApiError,
}))

vi.mock('../../../../../../../lib/chat/persistence', () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

import { GET } from '../route'

const SUBJECT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_STUDY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateSubjectAccess.mockResolvedValue({
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: 'user_ficticio',
    study: { id: OTHER_STUDY_ID },
    subject: {
      id: SUBJECT_ID,
      subjectCode: 'FIC-001',
      studyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'screening',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    },
  })
})

describe('S4 — metadata del sujeto compara el estudio de la URL', () => {
  it('pasa el id de la URL antes de auditar', async () => {
    await GET(new Request('http://localhost/api/subjects/metadata'), {
      params: Promise.resolve({ id: OTHER_STUDY_ID, subjectId: SUBJECT_ID }),
    })

    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT_ID, OTHER_STUDY_ID)
  })
})
