import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chunk, Document, DocumentVersion } from '@ichtys/db'

interface FindFirstArgs {
  where: unknown
}

interface FindManyArgs {
  where: unknown
}

type FindFirst<T> = (args: FindFirstArgs) => Promise<T | null>
type FindMany<T> = (args: FindManyArgs) => Promise<T[]>

interface SetWhereBuilder {
  where: (where: unknown) => Promise<unknown>
}

interface UpdateBuilder {
  set: (values: unknown) => SetWhereBuilder
}

interface DbClient {
  update: (table: unknown) => UpdateBuilder
}

type TransactionCallback = (tx: DbClient) => Promise<void>

interface DbOperation {
  kind: 'update' | 'insert'
  table: unknown
  values?: unknown
  where?: unknown
}

const mocks = vi.hoisted(() => ({
  documentVersionsFindFirst: vi.fn<FindFirst<DocumentVersion>>(),
  documentsFindFirst: vi.fn<FindFirst<Document>>(),
  chunksFindMany: vi.fn<FindMany<Chunk>>(),
  embedBatch: vi.fn<(texts: readonly string[]) => Promise<{ embedding: number[]; tokenCount: number }[]>>(),
  transaction: vi.fn<(callback: TransactionCallback) => Promise<void>>(),
  operations: [] as DbOperation[],
  tables: {
    auditLogs: { id: 'auditLogs.id' },
    chunks: {
      id: 'chunks.id',
      documentId: 'chunks.documentId',
      documentVersionId: 'chunks.documentVersionId',
      organizationId: 'chunks.organizationId',
      studyId: 'chunks.studyId',
      embedding: 'chunks.embedding',
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
  },
  and: vi.fn((...conditions: readonly unknown[]) => ({ conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  isNull: vi.fn((column: unknown) => ({ isNull: column })),
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
  }
}

vi.mock('drizzle-orm', () => ({
  and: mocks.and,
  eq: mocks.eq,
  isNull: mocks.isNull,
}))

vi.mock('../embedder', () => ({
  EmbeddingError: class EmbeddingError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'EmbeddingError'
    }
  },
  embedBatch: mocks.embedBatch,
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
      chunks: {
        findMany: mocks.chunksFindMany,
      },
    },
    transaction: mocks.transaction,
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        mocks.operations.push({ kind: 'insert', table, values })
        return undefined
      },
    }),
  },
  auditLogs: mocks.tables.auditLogs,
  chunks: mocks.tables.chunks,
  documents: mocks.tables.documents,
  documentVersions: mocks.tables.documentVersions,
}))

import { indexDocumentVersionChunks, type IndexDocumentVersionInput } from '../indexer'

interface IndexerFixture {
  input: IndexDocumentVersionInput
  document: Document
  documentVersion: DocumentVersion
  chunks: Chunk[]
}

function createEmbedding(value: number): number[] {
  return Array.from({ length: 1536 }, () => value)
}

function createFixture(): IndexerFixture {
  const orgId = crypto.randomUUID()
  const studyId = crypto.randomUUID()
  const documentId = crypto.randomUUID()
  const documentVersionId = crypto.randomUUID()
  const createdAt = new Date()
  const chunkId = crypto.randomUUID()

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
      pageCount: 1,
      fileSizeBytes: 100,
      status: 'processing',
      errorMessage: null,
      versionNumber: 1,
      createdAt,
    },
    chunks: [
      {
        id: chunkId,
        documentId,
        documentVersionId,
        organizationId: orgId,
        studyId,
        documentType: 'protocol',
        pageStart: 1,
        pageEnd: 1,
        sectionTitle: null,
        content: 'Eligibility criteria require documented lab review.',
        tokenCount: 12,
        embedding: null,
        createdAt,
      },
    ],
  }
}

function operationValues<T>(operation: DbOperation | undefined): T | null {
  return operation?.values && typeof operation.values === 'object' ? (operation.values as T) : null
}

describe('indexDocumentVersionChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.operations.length = 0
    mocks.transaction.mockImplementation(async (callback) => callback(createDbClient()))
  })

  it('embeds only chunks loaded for the authorized document version and tenant', async () => {
    const fixture = createFixture()
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.chunksFindMany.mockResolvedValue(fixture.chunks)
    mocks.embedBatch.mockResolvedValue([{ embedding: createEmbedding(0.1), tokenCount: 13 }])

    const result = await indexDocumentVersionChunks(fixture.input)

    expect(result).toMatchObject({
      documentId: fixture.input.documentId,
      documentVersionId: fixture.input.documentVersionId,
      chunkCount: 1,
      embeddedChunkCount: 1,
    })
    expect(mocks.embedBatch).toHaveBeenCalledWith([fixture.chunks[0]?.content])
    expect(mocks.eq).toHaveBeenCalledWith('documentVersions.organizationId', fixture.input.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('documentVersions.studyId', fixture.input.studyId)
    expect(mocks.eq).toHaveBeenCalledWith('chunks.organizationId', fixture.input.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('chunks.studyId', fixture.input.studyId)
    expect(mocks.isNull).toHaveBeenCalledWith('chunks.embedding')
  })

  it('does not touch chunks when documentVersion is outside the authorized tenant', async () => {
    const fixture = createFixture()
    mocks.documentVersionsFindFirst.mockResolvedValue(null)

    await expect(indexDocumentVersionChunks(fixture.input)).rejects.toMatchObject({
      code: 'embedding_internal_error',
    })

    expect(mocks.chunksFindMany).not.toHaveBeenCalled()
    expect(mocks.embedBatch).not.toHaveBeenCalled()
    expect(mocks.operations).toEqual([])
  })

  it('persists embeddings with tenant boundaries on every update', async () => {
    const fixture = createFixture()
    const embedding = createEmbedding(0.2)
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.chunksFindMany.mockResolvedValue(fixture.chunks)
    mocks.embedBatch.mockResolvedValue([{ embedding, tokenCount: 14 }])

    await indexDocumentVersionChunks(fixture.input)

    const update = mocks.operations.find(
      (operation) => operation.kind === 'update' && operation.table === mocks.tables.chunks,
    )
    expect(operationValues<{ embedding?: number[]; tokenCount?: number }>(update)).toMatchObject({
      embedding,
      tokenCount: 14,
    })
    expect(mocks.eq).toHaveBeenCalledWith('chunks.id', fixture.chunks[0]?.id)
    expect(mocks.eq).toHaveBeenCalledWith('chunks.documentId', fixture.input.documentId)
    expect(mocks.eq).toHaveBeenCalledWith('chunks.documentVersionId', fixture.input.documentVersionId)
    expect(mocks.eq).toHaveBeenCalledWith('chunks.organizationId', fixture.input.orgId)
    expect(mocks.eq).toHaveBeenCalledWith('chunks.studyId', fixture.input.studyId)
  })

  it('creates embeddings started and completed audit logs', async () => {
    const fixture = createFixture()
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.chunksFindMany.mockResolvedValue(fixture.chunks)
    mocks.embedBatch.mockResolvedValue([{ embedding: createEmbedding(0.3), tokenCount: 15 }])

    await indexDocumentVersionChunks(fixture.input)

    expect(mocks.operations).toContainEqual({
      kind: 'insert',
      table: mocks.tables.auditLogs,
      values: expect.objectContaining({
        organizationId: fixture.input.orgId,
        studyId: fixture.input.studyId,
        userId: fixture.input.userId,
        action: 'embeddings.started',
        resourceType: 'document_version',
        resourceId: fixture.input.documentVersionId,
      }),
    })
    expect(mocks.operations).toContainEqual({
      kind: 'insert',
      table: mocks.tables.auditLogs,
      values: expect.objectContaining({
        organizationId: fixture.input.orgId,
        studyId: fixture.input.studyId,
        userId: fixture.input.userId,
        action: 'embeddings.completed',
        resourceType: 'document_version',
        resourceId: fixture.input.documentVersionId,
      }),
    })
  })

  it('audits embeddings.failed with a sanitized code when embedding generation fails', async () => {
    const fixture = createFixture()
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue(fixture.document)
    mocks.chunksFindMany.mockResolvedValue(fixture.chunks)
    mocks.embedBatch.mockRejectedValue(new Error('provider leaked sensitive internals'))

    await expect(indexDocumentVersionChunks(fixture.input)).rejects.toMatchObject({
      code: 'embedding_internal_error',
    })

    expect(mocks.operations).toContainEqual({
      kind: 'insert',
      table: mocks.tables.auditLogs,
      values: expect.objectContaining({
        organizationId: fixture.input.orgId,
        studyId: fixture.input.studyId,
        userId: fixture.input.userId,
        action: 'embeddings.failed',
        resourceType: 'document_version',
        resourceId: fixture.input.documentVersionId,
        metadata: expect.objectContaining({
          documentId: fixture.input.documentId,
          errorMessage: 'embedding_internal_error',
        }),
      }),
    })
  })
})
