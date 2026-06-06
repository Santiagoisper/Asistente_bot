import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Citation,
  Document,
  DocumentVersion,
  Message,
  Organization,
  Page,
  Study,
} from '@ichtys/db'

interface ClerkAuthState {
  userId: string | null
  orgId: string | null
  orgRole: string | null
}

interface FindFirstArgs {
  where: unknown
}

interface FindManyArgs {
  where: unknown
}

type FindFirst<T> = (args: FindFirstArgs) => Promise<T | null>
type FindMany<T> = (args: FindManyArgs) => Promise<T[]>

interface CitationWhereColumns {
  messageId: string
  organizationId: string
  studyId: string
}

interface QueryOperators {
  and: (...conditions: readonly unknown[]) => unknown
  eq: (left: unknown, right: unknown) => unknown
}

type CitationWhere = (citation: CitationWhereColumns, operators: QueryOperators) => unknown

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<ClerkAuthState>>(),
  organizationsFindFirst: vi.fn<FindFirst<Organization>>(),
  studiesFindFirst: vi.fn<FindFirst<Study>>(),
  documentsFindFirst: vi.fn<FindFirst<Document>>(),
  documentVersionsFindFirst: vi.fn<FindFirst<DocumentVersion>>(),
  pagesFindFirst: vi.fn<FindFirst<Page>>(),
  messagesFindFirst: vi.fn<FindFirst<Message>>(),
  citationsFindMany: vi.fn<FindMany<Citation>>(),
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
      documents: {
        findFirst: mocks.documentsFindFirst,
      },
      documentVersions: {
        findFirst: mocks.documentVersionsFindFirst,
      },
      pages: {
        findFirst: mocks.pagesFindFirst,
      },
      messages: {
        findFirst: mocks.messagesFindFirst,
      },
      citations: {
        findMany: mocks.citationsFindMany,
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
  documents: {
    id: 'documents.id',
    organizationId: 'documents.organizationId',
  },
  documentVersions: {
    documentId: 'documentVersions.documentId',
    organizationId: 'documentVersions.organizationId',
    studyId: 'documentVersions.studyId',
  },
  pages: {
    documentVersionId: 'pages.documentVersionId',
    organizationId: 'pages.organizationId',
    studyId: 'pages.studyId',
    pageNumber: 'pages.pageNumber',
  },
  messages: {
    id: 'messages.id',
    organizationId: 'messages.organizationId',
  },
  citations: {
    messageId: 'citations.messageId',
    organizationId: 'citations.organizationId',
    studyId: 'citations.studyId',
  },
}))

import {
  validateDocumentAccess,
  validateDocumentPageAccess,
  validateMessageAccess,
} from '../object-access'
import { validateStudyAccess } from '../validate-study-access'
import { POST as chatPost } from '../../../apps/web/app/api/chat/route'
import { GET as citationsGet } from '../../../apps/web/app/api/citations/[messageId]/route'
import { GET as documentPageGet } from '../../../apps/web/app/api/documents/[id]/page/[pageNumber]/route'
import { GET as documentStatusGet } from '../../../apps/web/app/api/documents/[id]/status/route'

interface TenantFixture {
  userId: string
  clerkOrgId: string
  orgId: string
  studyId: string
  documentId: string
  documentVersionId: string
  pageId: string
  messageId: string
  citationId: string
  chunkId: string
  org: Organization
  study: Study
  document: Document
  documentVersion: DocumentVersion
  page: Page
  message: Message
  citation: Citation
}

function createTenantFixture(): TenantFixture {
  const userId = crypto.randomUUID()
  const clerkOrgId = crypto.randomUUID()
  const orgId = crypto.randomUUID()
  const studyId = crypto.randomUUID()
  const documentId = crypto.randomUUID()
  const documentVersionId = crypto.randomUUID()
  const pageId = crypto.randomUUID()
  const messageId = crypto.randomUUID()
  const citationId = crypto.randomUUID()
  const chunkId = crypto.randomUUID()
  const createdAt = new Date()

  return {
    userId,
    clerkOrgId,
    orgId,
    studyId,
    documentId,
    documentVersionId,
    pageId,
    messageId,
    citationId,
    chunkId,
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
    document: {
      id: documentId,
      organizationId: orgId,
      studyId,
      name: crypto.randomUUID(),
      documentType: 'protocol',
      createdAt,
    },
    documentVersion: {
      id: documentVersionId,
      documentId,
      organizationId: orgId,
      studyId,
      blobUrl: crypto.randomUUID(),
      blobKey: crypto.randomUUID(),
      pageCount: 1,
      fileSizeBytes: 100,
      status: 'ready',
      errorMessage: null,
      versionNumber: 1,
      createdAt,
    },
    page: {
      id: pageId,
      documentVersionId,
      organizationId: orgId,
      studyId,
      pageNumber: 1,
      rawText: crypto.randomUUID(),
      createdAt,
    },
    message: {
      id: messageId,
      conversationId: crypto.randomUUID(),
      organizationId: orgId,
      studyId,
      role: 'assistant',
      content: crypto.randomUUID(),
      confidence: 'high',
      createdAt,
    },
    citation: {
      id: citationId,
      messageId,
      chunkId,
      organizationId: orgId,
      studyId,
      documentId,
      documentVersionId,
      documentName: crypto.randomUUID(),
      documentType: 'protocol',
      pageStart: 1,
      pageEnd: 1,
      sectionTitle: null,
      excerpt: crypto.randomUUID(),
      similarityScore: 0.95,
      createdAt,
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

function mockActiveOrgAndStudy(fixture: TenantFixture): void {
  setActiveClerkSession(fixture)
  mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
  mocks.studiesFindFirst.mockResolvedValue(fixture.study)
}

function createJsonRequest(body: object): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createGetRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
  })
}

function isCitationWhere(value: unknown): value is CitationWhere {
  return typeof value === 'function'
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
    mockActiveOrgAndStudy(fixture)

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

describe('object-level authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validateDocumentAccess returns a document that belongs to the active org and study', async () => {
    const fixture = createTenantFixture()
    mockActiveOrgAndStudy(fixture)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)

    const result = await validateDocumentAccess(fixture.documentId)

    expect(result.userId).toBe(fixture.userId)
    expect(result.orgId).toBe(fixture.orgId)
    expect(result.studyId).toBe(fixture.studyId)
    expect(result.document).toEqual(fixture.document)
    expect(mocks.eq).toHaveBeenCalledWith('documents.organizationId', fixture.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('studies.id', fixture.studyId)
  })

  it('validateDocumentAccess denies a document from another org', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.documentsFindFirst.mockResolvedValue(null)

    await expect(validateDocumentAccess(fixture.documentId)).rejects.toMatchObject({ status: 404 })
    expect(mocks.studiesFindFirst).not.toHaveBeenCalled()
  })

  it('validateMessageAccess returns a message that belongs to the active org and study', async () => {
    const fixture = createTenantFixture()
    mockActiveOrgAndStudy(fixture)
    mocks.messagesFindFirst.mockResolvedValue(fixture.message)

    const result = await validateMessageAccess(fixture.messageId)

    expect(result.userId).toBe(fixture.userId)
    expect(result.orgId).toBe(fixture.orgId)
    expect(result.studyId).toBe(fixture.studyId)
    expect(result.message).toEqual(fixture.message)
    expect(mocks.eq).toHaveBeenCalledWith('messages.organizationId', fixture.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('studies.id', fixture.studyId)
  })

  it('validateMessageAccess denies a message from another org', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.messagesFindFirst.mockResolvedValue(null)

    await expect(validateMessageAccess(fixture.messageId)).rejects.toMatchObject({ status: 404 })
    expect(mocks.studiesFindFirst).not.toHaveBeenCalled()
  })

  it('validateDocumentPageAccess returns a page scoped to the validated document org and study', async () => {
    const fixture = createTenantFixture()
    mockActiveOrgAndStudy(fixture)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.pagesFindFirst.mockResolvedValue(fixture.page)

    const result = await validateDocumentPageAccess(fixture.documentId, fixture.page.pageNumber)

    expect(result.document).toEqual(fixture.document)
    expect(result.documentVersion).toEqual(fixture.documentVersion)
    expect(result.page).toEqual(fixture.page)
    expect(mocks.eq).toHaveBeenCalledWith('pages.organizationId', fixture.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('pages.studyId', fixture.studyId)
  })

  it('document status rejects a documentId from another org', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.documentsFindFirst.mockResolvedValue(null)

    const response = await documentStatusGet(createGetRequest('/api/documents/status'), {
      params: Promise.resolve({ id: fixture.documentId }),
    })

    expect(response.status).toBe(404)
  })

  it('document status ignores organization_id sent by the client', async () => {
    const fixture = createTenantFixture()
    mockActiveOrgAndStudy(fixture)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)

    const response = await documentStatusGet(
      createGetRequest(`/api/documents/status?organization_id=${crypto.randomUUID()}`),
      {
        params: Promise.resolve({ id: fixture.documentId }),
      },
    )

    expect(response.status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('documents.organizationId', fixture.orgId)
  })

  it('citations rejects a messageId from another org', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.messagesFindFirst.mockResolvedValue(null)

    const response = await citationsGet(createGetRequest('/api/citations/message'), {
      params: Promise.resolve({ messageId: fixture.messageId }),
    })

    expect(response.status).toBe(404)
    expect(mocks.citationsFindMany).not.toHaveBeenCalled()
  })

  it('citations only returns citations for the message org and study', async () => {
    const fixture = createTenantFixture()
    mockActiveOrgAndStudy(fixture)
    mocks.messagesFindFirst.mockResolvedValue(fixture.message)
    mocks.citationsFindMany.mockImplementation(async (args) => {
      if (isCitationWhere(args.where)) {
        args.where(
          {
            messageId: 'citations.messageId',
            organizationId: 'citations.organizationId',
            studyId: 'citations.studyId',
          },
          { and: mocks.and, eq: mocks.eq },
        )
      }

      return [fixture.citation]
    })

    const response = await citationsGet(createGetRequest('/api/citations/message'), {
      params: Promise.resolve({ messageId: fixture.messageId }),
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      messageId: fixture.messageId,
      citations: [
        {
          id: fixture.citationId,
          messageId: fixture.messageId,
          organizationId: fixture.orgId,
          studyId: fixture.studyId,
        },
      ],
    })
    expect(mocks.eq).toHaveBeenCalledWith('citations.messageId', fixture.messageId)
    expect(mocks.eq).toHaveBeenCalledWith('citations.organizationId', fixture.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('citations.studyId', fixture.studyId)
  })

  it('page endpoint rejects a document/page from another org', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.documentsFindFirst.mockResolvedValue(null)

    const response = await documentPageGet(createGetRequest('/api/documents/page'), {
      params: Promise.resolve({ id: fixture.documentId, pageNumber: String(fixture.page.pageNumber) }),
    })

    expect(response.status).toBe(404)
    expect(mocks.documentVersionsFindFirst).not.toHaveBeenCalled()
    expect(mocks.pagesFindFirst).not.toHaveBeenCalled()
  })
})
