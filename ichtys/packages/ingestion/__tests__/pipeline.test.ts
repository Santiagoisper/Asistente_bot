import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Document, DocumentVersion } from '@ichtys/db'

interface FindFirstArgs {
  where: unknown
}

type FindFirst<T> = (args: FindFirstArgs) => Promise<T | null>

interface SetWhereBuilder {
  where: (where: unknown) => Promise<unknown>
}

interface UpdateBuilder {
  set: (values: unknown) => SetWhereBuilder
}

interface DeleteBuilder {
  where: (where: unknown) => Promise<unknown>
}

interface InsertBuilder {
  values: (values: unknown) => Promise<unknown>
}

interface DbClient {
  update: (table: unknown) => UpdateBuilder
  delete: (table: unknown) => DeleteBuilder
  insert: (table: unknown) => InsertBuilder
}

type TransactionCallback = (tx: DbClient) => Promise<void>

interface DbOperation {
  kind: 'update' | 'delete' | 'insert'
  table: unknown
  values?: unknown
  where?: unknown
}

interface BlobGetResult {
  statusCode?: number
  stream: ReadableStream<Uint8Array> | null
}

const mocks = vi.hoisted(() => ({
  documentVersionsFindFirst: vi.fn<FindFirst<DocumentVersion>>(),
  documentsFindFirst: vi.fn<FindFirst<Document>>(),
  get: vi.fn<(pathname: string, options: { access: 'private'; useCache: false }) => Promise<BlobGetResult | null>>(),
  fetchMock: vi.fn<typeof fetch>(),
  parsePdf: vi.fn<() => Promise<{ pageCount: number; pages: { pageNumber: number; rawText: string }[] }>>(),
  indexDocumentVersionChunks: vi.fn<
    (input: RunIngestionInput) => Promise<{ embeddedChunkCount: number }>
  >(),
  transaction: vi.fn<(callback: TransactionCallback) => Promise<void>>(),
  operations: [] as DbOperation[],
  tables: {
    auditLogs: { id: 'auditLogs.id' },
    chunks: {
      documentVersionId: 'chunks.documentVersionId',
      organizationId: 'chunks.organizationId',
      studyId: 'chunks.studyId',
    },
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
    pages: {
      documentVersionId: 'pages.documentVersionId',
      organizationId: 'pages.organizationId',
      studyId: 'pages.studyId',
    },
  },
}))

function createDbClient(): DbClient {
  return {
    update: (table) => ({
      set: (values) => ({
        where: async (where) => {
          mocks.operations.push({ kind: 'update', table, values, where })
          return undefined
        },
      }),
    }),
    delete: (table) => ({
      where: async (where) => {
        mocks.operations.push({ kind: 'delete', table, where })
        return undefined
      },
    }),
    insert: (table) => ({
      values: async (values) => {
        mocks.operations.push({ kind: 'insert', table, values })
        return undefined
      },
    }),
  }
}

vi.mock('@vercel/blob', () => ({
  get: mocks.get,
}))

vi.mock('../parser', () => ({
  PdfParseError: class PdfParseError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'PdfParseError'
    }
  },
  parsePdf: mocks.parsePdf,
}))

vi.mock('../indexer', () => ({
  EmbeddingIndexingError: class EmbeddingIndexingError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'EmbeddingIndexingError'
    }
  },
  indexDocumentVersionChunks: mocks.indexDocumentVersionChunks,
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: {
      documentVersions: {
        findFirst: mocks.documentVersionsFindFirst,
      },
      documents: {
        findFirst: mocks.documentsFindFirst,
      },
    },
    transaction: mocks.transaction,
    ...createDbClient(),
  },
  auditLogs: mocks.tables.auditLogs,
  chunks: mocks.tables.chunks,
  documents: mocks.tables.documents,
  documentVersions: mocks.tables.documentVersions,
  pages: mocks.tables.pages,
}))

import { runIngestion, type RunIngestionInput } from '../pipeline'

interface PipelineFixture {
  input: RunIngestionInput
  document: Document
  documentVersion: DocumentVersion
}

function createFixture(): PipelineFixture {
  const orgId = crypto.randomUUID()
  const studyId = crypto.randomUUID()
  const documentId = crypto.randomUUID()
  const documentVersionId = crypto.randomUUID()
  const createdAt = new Date()

  return {
    input: {
      userId: crypto.randomUUID(),
      orgId,
      studyId,
      documentId,
      documentVersionId,
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
      blobKey: `clinical-documents/${crypto.randomUUID()}/document.pdf`,
      pageCount: null,
      fileSizeBytes: 100,
      status: 'pending',
      errorMessage: null,
      versionNumber: 1,
      createdAt,
    },
  }
}

function createBlobStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      controller.close()
    },
  })
}

function operationValues<T>(operation: DbOperation): T | null {
  return operation.values && typeof operation.values === 'object' ? (operation.values as T) : null
}

describe('runIngestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.operations.length = 0
    mocks.transaction.mockImplementation(async (callback) => callback(createDbClient()))
    // Mock global fetch — pipeline uses fetch(blobUrl) for public blobs.
    vi.stubGlobal('fetch', mocks.fetchMock)
    mocks.fetchMock.mockResolvedValue(new Response(createBlobStream()))
  })

  it('inserts pages and chunks with organization_id and study_id, embeds chunks, then marks ready', async () => {
    const fixture = createFixture()
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.parsePdf.mockResolvedValue({
      pageCount: 2,
      pages: [
        { pageNumber: 1, rawText: '1. ELIGIBILITY\nPatients must meet all criteria.' },
        { pageNumber: 2, rawText: 'Study procedures continue on page two.' },
      ],
    })
    mocks.indexDocumentVersionChunks.mockResolvedValue({ embeddedChunkCount: 1 })

    const result = await runIngestion(fixture.input)

    expect(result).toMatchObject({
      documentId: fixture.input.documentId,
      documentVersionId: fixture.input.documentVersionId,
      pageCount: 2,
      embeddedChunkCount: 1,
      status: 'ready',
    })

    const pageInsert = mocks.operations.find(
      (operation) => operation.kind === 'insert' && operation.table === mocks.tables.pages,
    )
    const chunkInsert = mocks.operations.find(
      (operation) => operation.kind === 'insert' && operation.table === mocks.tables.chunks,
    )
    const readyUpdate = mocks.operations.find((operation) => {
      const values = operationValues<{ status?: string }>(operation)
      return operation.kind === 'update' && values?.status === 'ready'
    })

    const pageValues = operationValues<
      {
        documentVersionId: string
        organizationId: string
        studyId: string
        pageNumber: number
        rawText: string
      }[]
    >(pageInsert ?? { kind: 'insert', table: null })
    const chunkValues = operationValues<
      {
        documentId: string
        documentVersionId: string
        organizationId: string
        studyId: string
        pageStart: number
        pageEnd: number
        content: string
      }[]
    >(chunkInsert ?? { kind: 'insert', table: null })

    expect(pageValues).toBeDefined()
    expect(chunkValues).toBeDefined()
    expect(pageValues?.every((page) => page.organizationId === fixture.input.orgId)).toBe(true)
    expect(pageValues?.every((page) => page.studyId === fixture.input.studyId)).toBe(true)
    expect(chunkValues?.every((chunk) => chunk.organizationId === fixture.input.orgId)).toBe(true)
    expect(chunkValues?.every((chunk) => chunk.studyId === fixture.input.studyId)).toBe(true)
    expect(mocks.indexDocumentVersionChunks).toHaveBeenCalledWith(fixture.input)
    expect(readyUpdate).toBeDefined()
  })

  it('marks error with a sanitized message if parsing fails', async () => {
    const fixture = createFixture()
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.parsePdf.mockRejectedValue(new Error('raw parser stack'))

    const result = await runIngestion(fixture.input)

    expect(result).toMatchObject({
      status: 'error',
      errorMessage: 'ingestion_internal_error',
    })
    expect(
      mocks.operations.some((operation) => {
        const values = operationValues<{ status?: string; errorMessage?: string }>(operation)
        return (
          operation.kind === 'update' &&
          values?.status === 'error' &&
          values.errorMessage === 'ingestion_internal_error'
        )
      }),
    ).toBe(true)
  })

  it('marks error with a sanitized message if embedding indexing fails and does not mark ready', async () => {
    const fixture = createFixture()
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.parsePdf.mockResolvedValue({
      pageCount: 1,
      pages: [{ pageNumber: 1, rawText: 'Eligibility criteria require documented lab review.' }],
    })
    mocks.indexDocumentVersionChunks.mockRejectedValue(
      new Error('provider leaked sensitive embedding internals'),
    )

    const result = await runIngestion(fixture.input)

    expect(result).toMatchObject({
      status: 'error',
      errorMessage: 'ingestion_internal_error',
    })
    expect(
      mocks.operations.some((operation) => {
        const values = operationValues<{ status?: string; errorMessage?: string }>(operation)
        return (
          operation.kind === 'update' &&
          values?.status === 'error' &&
          values.errorMessage === 'ingestion_internal_error'
        )
      }),
    ).toBe(true)
    expect(
      mocks.operations.some((operation) => {
        const values = operationValues<{ status?: string }>(operation)
        return operation.kind === 'update' && values?.status === 'ready'
      }),
    ).toBe(false)
  })
})
