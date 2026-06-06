import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
  orderBy?: unknown
}

interface FindManyArgs {
  where: unknown
}

type FindFirst<T> = (args: FindFirstArgs) => Promise<T | null>
type FindMany<T> = (args: FindManyArgs) => Promise<T[]>

interface BlobPutResult {
  url: string
  downloadUrl: string
  pathname: string
  contentType: string
  contentDisposition: string
}

interface BlobPutOptions {
  access: 'private'
  addRandomSuffix?: boolean
  allowOverwrite?: boolean
  contentType?: string
}

interface PutPrivateDocumentPdfInput {
  blobKey: string
  file: File
}

interface IngestionContextInput {
  userId: string
  orgId: string
  studyId: string
  documentId: string
  documentVersionId: string
}

interface IngestionRouteResult {
  documentId: string
  documentVersionId: string
  status: 'processing' | 'ready' | 'error'
}

interface InsertCall {
  table: unknown
  values: unknown
}

interface ReturningInsert {
  returning: () => Promise<unknown[]>
}

interface InsertValuesBuilder {
  values: (values: unknown) => ReturningInsert
}

interface TransactionClient {
  insert: (table: unknown) => InsertValuesBuilder
}

type TransactionCallback = (tx: TransactionClient) => Promise<unknown>

interface CitationWhereColumns {
  messageId: string
  organizationId: string
  studyId: string
}

interface DocumentVersionWhereColumns {
  documentId: string
  organizationId: string
  studyId: string
}

interface QueryOperators {
  and: (...conditions: readonly unknown[]) => unknown
  eq: (left: unknown, right: unknown) => unknown
}

type CitationWhere = (citation: CitationWhereColumns, operators: QueryOperators) => unknown
type DocumentVersionWhere = (
  documentVersion: DocumentVersionWhereColumns,
  operators: QueryOperators,
) => unknown

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<ClerkAuthState>>(),
  put: vi.fn<(pathname: string, body: File, options: BlobPutOptions) => Promise<BlobPutResult>>(),
  organizationsFindFirst: vi.fn<FindFirst<Organization>>(),
  studiesFindFirst: vi.fn<FindFirst<Study>>(),
  documentsFindFirst: vi.fn<FindFirst<Document>>(),
  documentVersionsFindFirst: vi.fn<FindFirst<DocumentVersion>>(),
  pagesFindFirst: vi.fn<FindFirst<Page>>(),
  messagesFindFirst: vi.fn<FindFirst<Message>>(),
  citationsFindMany: vi.fn<FindMany<Citation>>(),
  runIngestion: vi.fn<(input: IngestionContextInput) => Promise<IngestionRouteResult>>(),
  transaction: vi.fn<(callback: TransactionCallback) => Promise<unknown>>(),
  txInsert: vi.fn<(table: unknown) => InsertValuesBuilder>(),
  insertedValues: [] as InsertCall[],
  tables: {
    documents: {
      id: 'documents.id',
      organizationId: 'documents.organizationId',
      studyId: 'documents.studyId',
    },
    documentVersions: {
      id: 'documentVersions.id',
      documentId: 'documentVersions.documentId',
      organizationId: 'documentVersions.organizationId',
      studyId: 'documentVersions.studyId',
    },
    auditLogs: {
      id: 'auditLogs.id',
    },
  },
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
    transaction: mocks.transaction,
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
  documents: mocks.tables.documents,
  documentVersions: mocks.tables.documentVersions,
  auditLogs: mocks.tables.auditLogs,
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
  validateDocumentVersionAccess,
  validateDocumentPageAccess,
  validateMessageAccess,
} from '../object-access'
import { validateStudyAccess } from '../validate-study-access'
import { POST as chatPost } from '../../../apps/web/app/api/chat/route'
import { GET as citationsGet } from '../../../apps/web/app/api/citations/[messageId]/route'
import { GET as documentPageGet } from '../../../apps/web/app/api/documents/[id]/page/[pageNumber]/route'
import { GET as documentStatusGet } from '../../../apps/web/app/api/documents/[id]/status/route'

type DocumentUploadPost = (req: Request) => Promise<Response>

let documentUploadPost: DocumentUploadPost
let ingestionRunPost: DocumentUploadPost
let maxPdfBytes = 0

beforeAll(async () => {
  vi.doMock('../../../apps/web/app/api/documents/upload/blob-storage', () => ({
    putPrivateDocumentPdf: async ({ blobKey, file }: PutPrivateDocumentPdfInput) => {
      const blob = await mocks.put(blobKey, file, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/pdf',
      })

      return {
        url: blob.url,
        pathname: blob.pathname,
      }
    },
  }))

  vi.doMock('@ichtys/ingestion', () => ({
    runIngestion: mocks.runIngestion,
  }))

  const uploadRoute = await import('../../../apps/web/app/api/documents/upload/route')
  const ingestionRoute = await import('../../../apps/web/app/api/ingestion/run/route')
  documentUploadPost = uploadRoute.POST
  ingestionRunPost = ingestionRoute.POST
  maxPdfBytes = uploadRoute.MAX_PDF_BYTES
})

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

function createJsonRequest(body: object, path = '/api/chat'): Request {
  return new Request(`http://localhost${path}`, {
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

function createUploadRequest(form: FormData, query = ''): Request {
  return new Request(`http://localhost/api/documents/upload${query}`, {
    method: 'POST',
    body: form,
  })
}

function createUploadForm(fixture: TenantFixture, file: File): FormData {
  const form = new FormData()
  form.set('file', file)
  form.set('studyId', fixture.studyId)
  form.set('documentType', fixture.document.documentType)
  form.set('name', fixture.document.name)
  return form
}

function createPdfFile(name = 'document.pdf', bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })
}

function createTextFile(): File {
  return new File([new Uint8Array(16)], 'document.txt', { type: 'text/plain' })
}

function mockBlobUpload(fixture: TenantFixture): void {
  mocks.put.mockResolvedValue({
    url: fixture.documentVersion.blobUrl,
    downloadUrl: `${fixture.documentVersion.blobUrl}?download=1`,
    pathname: fixture.documentVersion.blobKey,
    contentType: 'application/pdf',
    contentDisposition: 'inline',
  })
}

function mockUploadTransaction(fixture: TenantFixture): void {
  const tx: TransactionClient = {
    insert: mocks.txInsert,
  }

  mocks.transaction.mockImplementation(async (callback) => callback(tx))
  mocks.txInsert.mockImplementation((table) => ({
    values: (values) => {
      mocks.insertedValues.push({ table, values })

      return {
        returning: async () => {
          if (table === mocks.tables.documents) return [fixture.document]
          if (table === mocks.tables.documentVersions) return [fixture.documentVersion]
          return []
        },
      }
    },
  }))
}

function isCitationWhere(value: unknown): value is CitationWhere {
  return typeof value === 'function'
}

function isDocumentVersionWhere(value: unknown): value is DocumentVersionWhere {
  return typeof value === 'function'
}

function exerciseDocumentVersionWhere(): void {
  const latestCall = mocks.documentVersionsFindFirst.mock.calls.at(-1)
  const latestArgs = latestCall?.[0]
  if (latestArgs && isDocumentVersionWhere(latestArgs.where)) {
    latestArgs.where(
      {
        documentId: 'documentVersions.documentId',
        organizationId: 'documentVersions.organizationId',
        studyId: 'documentVersions.studyId',
      },
      { and: mocks.and, eq: mocks.eq },
    )
  }
}

describe('validateStudyAccess tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insertedValues.length = 0
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
    mocks.insertedValues.length = 0
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

  it('validateDocumentVersionAccess returns a version scoped to the active org and study', async () => {
    const fixture = createTenantFixture()
    mockActiveOrgAndStudy(fixture)
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)

    const result = await validateDocumentVersionAccess(fixture.documentVersionId)

    expect(result.userId).toBe(fixture.userId)
    expect(result.orgId).toBe(fixture.orgId)
    expect(result.studyId).toBe(fixture.studyId)
    expect(result.document).toEqual(fixture.document)
    expect(result.documentVersion).toEqual(fixture.documentVersion)
    expect(mocks.eq).toHaveBeenCalledWith('documentVersions.id', fixture.documentVersionId)
    expect(mocks.eq).toHaveBeenCalledWith('documentVersions.organizationId', fixture.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('documents.studyId', fixture.studyId)
  })

  it('validateDocumentVersionAccess denies a version from another org', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.documentVersionsFindFirst.mockResolvedValue(null)

    await expect(validateDocumentVersionAccess(fixture.documentVersionId)).rejects.toMatchObject({
      status: 404,
    })
    expect(mocks.documentsFindFirst).not.toHaveBeenCalled()
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
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)

    const response = await documentStatusGet(
      createGetRequest(`/api/documents/status?organization_id=${crypto.randomUUID()}`),
      {
        params: Promise.resolve({ id: fixture.documentId }),
      },
    )

    expect(response.status).toBe(200)
    exerciseDocumentVersionWhere()
    expect(mocks.eq).toHaveBeenCalledWith('documents.organizationId', fixture.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('documentVersions.organizationId', fixture.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('documentVersions.studyId', fixture.studyId)
  })

  it('document status returns the latest authorized document version', async () => {
    const fixture = createTenantFixture()
    mockActiveOrgAndStudy(fixture)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)

    const response = await documentStatusGet(createGetRequest('/api/documents/status'), {
      params: Promise.resolve({ id: fixture.documentId }),
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      documentId: fixture.documentId,
      latestDocumentVersionId: fixture.documentVersionId,
      status: fixture.documentVersion.status,
      pageCount: fixture.documentVersion.pageCount,
      errorMessage: null,
    })
  })

  it('document status reflects processing and error states with sanitized errors', async () => {
    const processingFixture = createTenantFixture()
    processingFixture.documentVersion.status = 'processing'
    mockActiveOrgAndStudy(processingFixture)
    mocks.documentsFindFirst.mockResolvedValue(processingFixture.document)
    mocks.documentVersionsFindFirst.mockResolvedValue(processingFixture.documentVersion)

    const processingResponse = await documentStatusGet(createGetRequest('/api/documents/status'), {
      params: Promise.resolve({ id: processingFixture.documentId }),
    })
    const processingBody: unknown = await processingResponse.json()

    expect(processingResponse.status).toBe(200)
    expect(processingBody).toMatchObject({
      documentId: processingFixture.documentId,
      latestDocumentVersionId: processingFixture.documentVersionId,
      status: 'processing',
      errorMessage: null,
    })

    vi.clearAllMocks()
    const errorFixture = createTenantFixture()
    errorFixture.documentVersion.status = 'error'
    errorFixture.documentVersion.errorMessage = 'stack trace that must not leak'
    mockActiveOrgAndStudy(errorFixture)
    mocks.documentsFindFirst.mockResolvedValue(errorFixture.document)
    mocks.documentVersionsFindFirst.mockResolvedValue(errorFixture.documentVersion)

    const errorResponse = await documentStatusGet(createGetRequest('/api/documents/status'), {
      params: Promise.resolve({ id: errorFixture.documentId }),
    })
    const errorBody: unknown = await errorResponse.json()

    expect(errorResponse.status).toBe(200)
    expect(errorBody).toMatchObject({
      documentId: errorFixture.documentId,
      latestDocumentVersionId: errorFixture.documentVersionId,
      status: 'error',
      errorMessage: 'Document processing failed',
    })
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

  it('ingestion rejects when there is no auth', async () => {
    const fixture = createTenantFixture()
    mocks.auth.mockResolvedValue({
      userId: null,
      orgId: fixture.clerkOrgId,
      orgRole: null,
    })

    const response = await ingestionRunPost(
      createJsonRequest({ documentVersionId: fixture.documentVersionId }, '/api/ingestion/run'),
    )

    expect(response.status).toBe(401)
    expect(mocks.runIngestion).not.toHaveBeenCalled()
  })

  it('ingestion rejects organization_id in the body', async () => {
    const fixture = createTenantFixture()

    const response = await ingestionRunPost(
      createJsonRequest(
        {
          documentVersionId: fixture.documentVersionId,
          organization_id: fixture.orgId,
        },
        '/api/ingestion/run',
      ),
    )

    expect(response.status).toBe(400)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.runIngestion).not.toHaveBeenCalled()
  })

  it('ingestion rejects organization_id in query params', async () => {
    const fixture = createTenantFixture()

    const response = await ingestionRunPost(
      createJsonRequest(
        { documentVersionId: fixture.documentVersionId },
        `/api/ingestion/run?organization_id=${crypto.randomUUID()}`,
      ),
    )

    expect(response.status).toBe(400)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.runIngestion).not.toHaveBeenCalled()
  })

  it('ingestion rejects a documentVersionId from another org', async () => {
    const fixture = createTenantFixture()
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.documentVersionsFindFirst.mockResolvedValue(null)

    const response = await ingestionRunPost(
      createJsonRequest({ documentVersionId: fixture.documentVersionId }, '/api/ingestion/run'),
    )

    expect(response.status).toBe(404)
    expect(mocks.runIngestion).not.toHaveBeenCalled()
  })

})

describe('document upload registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insertedValues.length = 0
  })

  it('upload rejects when there is no auth', async () => {
    const fixture = createTenantFixture()
    const form = createUploadForm(fixture, createPdfFile())
    mocks.auth.mockResolvedValue({
      userId: null,
      orgId: fixture.clerkOrgId,
      orgRole: null,
    })

    const response = await documentUploadPost(createUploadRequest(form))

    expect(response.status).toBe(401)
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('upload rejects organization_id in FormData', async () => {
    const fixture = createTenantFixture()
    const form = createUploadForm(fixture, createPdfFile())
    form.set('organization_id', crypto.randomUUID())

    const response = await documentUploadPost(createUploadRequest(form))

    expect(response.status).toBe(400)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('upload rejects organization_id in query params', async () => {
    const fixture = createTenantFixture()
    const form = createUploadForm(fixture, createPdfFile())

    const response = await documentUploadPost(
      createUploadRequest(form, `?organization_id=${crypto.randomUUID()}`),
    )

    expect(response.status).toBe(400)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('upload rejects a non-PDF file', async () => {
    const fixture = createTenantFixture()
    const form = createUploadForm(fixture, createTextFile())

    const response = await documentUploadPost(createUploadRequest(form))

    expect(response.status).toBe(415)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('upload rejects a PDF larger than the server upload limit', async () => {
    const fixture = createTenantFixture()
    const form = createUploadForm(fixture, createPdfFile('large.pdf', maxPdfBytes + 1))

    const response = await documentUploadPost(createUploadRequest(form))

    expect(response.status).toBe(413)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('upload validates studyId against the active org before creating records', async () => {
    const fixture = createTenantFixture()
    const form = createUploadForm(fixture, createPdfFile())
    setActiveClerkSession(fixture)
    mocks.organizationsFindFirst.mockResolvedValue(fixture.org)
    mocks.studiesFindFirst.mockResolvedValue(null)

    const response = await documentUploadPost(createUploadRequest(form))

    expect(response.status).toBe(404)
    expect(mocks.studiesFindFirst).toHaveBeenCalledOnce()
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('upload creates document and document_version with orgId from Clerk', async () => {
    const fixture = createTenantFixture()
    fixture.documentVersion.status = 'pending'
    const file = createPdfFile(fixture.document.name)
    const form = createUploadForm(fixture, file)
    mockActiveOrgAndStudy(fixture)
    mockBlobUpload(fixture)
    mockUploadTransaction(fixture)

    const response = await documentUploadPost(createUploadRequest(form))
    const body: unknown = await response.json()

    expect(response.status).toBe(202)
    expect(body).toMatchObject({
      documentId: fixture.documentId,
      documentVersionId: fixture.documentVersionId,
      status: 'pending',
      name: fixture.document.name,
      documentType: fixture.document.documentType,
    })
    const putCall = mocks.put.mock.calls[0]
    expect(putCall).toBeDefined()
    if (!putCall) {
      throw new Error('Expected Blob put to be called')
    }
    const [pathname, uploadedFile, blobOptions] = putCall
    expect(pathname).toMatch(/^clinical-documents\/[0-9a-f-]+\/.+/)
    expect(uploadedFile).toBeInstanceOf(File)
    expect(uploadedFile.name).toBe(file.name)
    expect(uploadedFile.size).toBe(file.size)
    expect(uploadedFile.type).toBe('application/pdf')
    expect(blobOptions).toMatchObject({
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/pdf',
    })
    expect(mocks.insertedValues).toContainEqual({
      table: mocks.tables.documents,
      values: expect.objectContaining({
        organizationId: fixture.orgId,
        studyId: fixture.studyId,
        name: fixture.document.name,
        documentType: fixture.document.documentType,
      }),
    })
    expect(mocks.insertedValues).toContainEqual({
      table: mocks.tables.documentVersions,
      values: expect.objectContaining({
        documentId: fixture.documentId,
        organizationId: fixture.orgId,
        studyId: fixture.studyId,
        blobUrl: fixture.documentVersion.blobUrl,
        blobKey: fixture.documentVersion.blobKey,
        fileSizeBytes: file.size,
        status: 'pending',
        versionNumber: 1,
      }),
    })
    expect(mocks.insertedValues).toContainEqual({
      table: mocks.tables.auditLogs,
      values: expect.objectContaining({
        organizationId: fixture.orgId,
        studyId: fixture.studyId,
        userId: fixture.userId,
        action: 'document.upload',
        resourceType: 'document',
        resourceId: fixture.documentId,
      }),
    })
  })
})
