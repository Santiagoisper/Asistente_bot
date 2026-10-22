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
    (input: RunIngestionInput, options?: { startedAt?: number }) => Promise<{ embeddedChunkCount: number }>
  >(),
  canReuseEmbeddedChunks: vi.fn<() => Promise<boolean>>(),
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

const specMocks = vi.hoisted(() => ({
  extractStudySpec: vi.fn(),
  saveStudySpec: vi.fn(),
  reextractStudySpec: vi.fn(),
}))

vi.mock('../spec-extractor', () => ({
  SPEC_EXTRACTION_LLM_PROVIDER: 'glm',
  extractStudySpec: specMocks.extractStudySpec,
}))

vi.mock('../spec-store', () => ({
  getApprovedSpecExamples: vi.fn(async () => []),
  isMeaningfulSpec: vi.fn(() => true),
  saveStudySpec: specMocks.saveStudySpec,
}))

vi.mock('../reextract-spec', () => ({
  reextractStudySpec: specMocks.reextractStudySpec,
}))

vi.mock('../chunk-reuse', () => ({
  canReuseEmbeddedChunks: mocks.canReuseEmbeddedChunks,
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
  getOrgRagConfig: vi.fn(async () => ({ llmProvider: 'auto', similarityThreshold: 0.15, topK: 12 })),
  getOrgLlmApiKeys: vi.fn(async () => ({})),
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
    mocks.canReuseEmbeddedChunks.mockResolvedValue(false)
    specMocks.extractStudySpec.mockResolvedValue({
      spec: {},
      warnings: [],
      extractionModel: 'modelo-sintetico',
      detectedLanguage: null,
    })
    specMocks.saveStudySpec.mockResolvedValue({ id: 'spec-1', version: 1 })
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
    expect(mocks.indexDocumentVersionChunks).toHaveBeenCalledWith(
      fixture.input,
      expect.objectContaining({ startedAt: expect.any(Number) }),
    )
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

describe('runIngestion: reintentos y paralelismo', () => {
  const twoPages = {
    pageCount: 2,
    pages: [
      { pageNumber: 1, rawText: '1. ELIGIBILITY\nPatients must meet all criteria.' },
      { pageNumber: 2, rawText: 'Study procedures continue on page two.' },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.operations.length = 0
    mocks.canReuseEmbeddedChunks.mockResolvedValue(false)
    mocks.transaction.mockImplementation(async (callback) => callback(createDbClient()))
    vi.stubGlobal('fetch', mocks.fetchMock)
    mocks.fetchMock.mockResolvedValue(new Response(createBlobStream()))
    specMocks.extractStudySpec.mockResolvedValue({
      spec: {},
      warnings: [],
      extractionModel: 'modelo-sintetico',
      detectedLanguage: null,
    })
    specMocks.saveStudySpec.mockResolvedValue({ id: 'spec-1', version: 1 })
  })

  function arrange(documentType: 'protocol' | 'lab_manual' = 'protocol'): PipelineFixture {
    const fixture = createFixture()
    mocks.documentVersionsFindFirst.mockResolvedValue(fixture.documentVersion)
    mocks.documentsFindFirst.mockResolvedValue({ ...fixture.document, documentType })
    mocks.parsePdf.mockResolvedValue(twoPages)
    return fixture
  }

  it('al reintentar con fragmentos ya embebidos no borra ni recrea paginas y fragmentos', async () => {
    const fixture = arrange()
    mocks.canReuseEmbeddedChunks.mockResolvedValue(true)
    mocks.indexDocumentVersionChunks.mockResolvedValue({ embeddedChunkCount: 0 })

    const result = await runIngestion(fixture.input)

    expect(result.status).toBe('ready')
    const touched = mocks.operations.filter(
      (op) =>
        (op.table === mocks.tables.chunks || op.table === mocks.tables.pages) &&
        (op.kind === 'delete' || op.kind === 'insert'),
    )
    expect(touched).toEqual([])
    expect(mocks.indexDocumentVersionChunks).toHaveBeenCalledTimes(1)
  })

  it('sin reutilizacion reemplaza paginas y fragmentos como antes', async () => {
    const fixture = arrange()
    mocks.indexDocumentVersionChunks.mockResolvedValue({ embeddedChunkCount: 1 })

    await runIngestion(fixture.input)

    const kinds = mocks.operations
      .filter((op) => op.table === mocks.tables.chunks || op.table === mocks.tables.pages)
      .map((op) => `${op.kind}:${op.table === mocks.tables.chunks ? 'chunks' : 'pages'}`)
    expect(kinds).toEqual(
      expect.arrayContaining(['delete:chunks', 'delete:pages', 'insert:pages', 'insert:chunks']),
    )
  })

  it('lanza la extraccion del spec mientras los embeddings siguen en curso', async () => {
    const fixture = arrange()
    let finishEmbeddings: (value: { embeddedChunkCount: number }) => void = () => undefined
    mocks.indexDocumentVersionChunks.mockImplementation(
      () => new Promise((resolve) => { finishEmbeddings = resolve }),
    )

    const running = runIngestion(fixture.input)
    await vi.waitFor(() => expect(mocks.indexDocumentVersionChunks).toHaveBeenCalledTimes(1))

    // Los embeddings todavía no terminaron y el spec ya empezó.
    expect(specMocks.extractStudySpec).toHaveBeenCalledTimes(1)
    expect(specMocks.saveStudySpec).not.toHaveBeenCalled()

    finishEmbeddings({ embeddedChunkCount: 2 })
    const result = await running

    expect(result.status).toBe('ready')
    expect(specMocks.saveStudySpec).toHaveBeenCalledTimes(1)
  })

  it('no guarda un borrador de spec si los embeddings fallan', async () => {
    const fixture = arrange()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.indexDocumentVersionChunks.mockRejectedValue(new Error('embedding_rate_limited'))

    const result = await runIngestion(fixture.input)

    expect(result.status).toBe('error')
    expect(specMocks.saveStudySpec).not.toHaveBeenCalled()
  })

  it('marca error visible si falla la extraccion del spec', async () => {
    const fixture = arrange()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    specMocks.extractStudySpec.mockRejectedValue(new Error('llm caido'))
    mocks.indexDocumentVersionChunks.mockResolvedValue({ embeddedChunkCount: 2 })

    const result = await runIngestion(fixture.input)

    expect(result.status).toBe('error')
    expect(result.errorMessage).toBe('spec_extraction_failed')
    expect(specMocks.saveStudySpec).not.toHaveBeenCalled()
  })

  it('marca error visible si el spec no llega antes del tope del trabajo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const fixture = arrange()
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      specMocks.extractStudySpec.mockImplementation(() => new Promise(() => undefined)) // nunca responde
      let startIndexing!: () => void
      let finishIndexing!: (result: { embeddedChunkCount: number }) => void
      const indexingStarted = new Promise<void>((resolve) => { startIndexing = resolve })
      mocks.indexDocumentVersionChunks.mockImplementation(() => {
        startIndexing()
        return new Promise((resolve) => { finishIndexing = resolve })
      })

      const running = runIngestion(fixture.input)
      await indexingStarted
      finishIndexing({ embeddedChunkCount: 2 })
      // El plazo se programa después de completar embeddings; la barrera garantiza que
      // el reloj avance solo cuando ese temporizador ya está instalado.
      await Promise.resolve()
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(265_000)
      const result = await running

      expect(result.status).toBe('error')
      expect(result.errorMessage).toBe('spec_extraction_failed')
      expect(specMocks.saveStudySpec).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('le pasa a los embeddings el inicio real del trabajo para compartir un unico plazo', async () => {
    const fixture = arrange()
    mocks.indexDocumentVersionChunks.mockResolvedValue({ embeddedChunkCount: 2 })
    const before = Date.now()

    await runIngestion(fixture.input)

    const options = mocks.indexDocumentVersionChunks.mock.calls[0]?.[1] as { startedAt: number } | undefined
    expect(options?.startedAt).toBeGreaterThanOrEqual(before)
    expect(options?.startedAt).toBeLessThanOrEqual(Date.now())
  })

  it('no extrae spec para documentos que no son protocolo', async () => {
    const fixture = arrange('lab_manual')
    mocks.indexDocumentVersionChunks.mockResolvedValue({ embeddedChunkCount: 2 })

    const result = await runIngestion(fixture.input)

    expect(result.status).toBe('ready')
    expect(specMocks.extractStudySpec).not.toHaveBeenCalled()
  })

  it('registra los tiempos por etapa sin incluir texto del documento', async () => {
    const fixture = arrange()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mocks.indexDocumentVersionChunks.mockResolvedValue({ embeddedChunkCount: 2 })

    await runIngestion(fixture.input)

    const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.includes('[ingestion] timings'))
    expect(line).toBeDefined()
    for (const stage of ['downloadMs', 'parseMs', 'chunkMs', 'dbMs', 'embedMs', 'specExtractMs', 'totalMs']) {
      expect(line).toContain(stage)
    }
    expect(line).not.toContain('ELIGIBILITY')
  })
})
