import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestDocumentType =
  | 'protocol'
  | 'investigator_brochure'
  | 'lab_manual'
  | 'pharmacy_manual'
  | 'other'

interface TestChunkRow {
  chunkId: string
  documentId: string
  documentVersionId: string
  organizationId: string
  studyId: string
  documentType: TestDocumentType
  pageStart: number
  pageEnd: number
  sectionTitle: string | null
  content: string
  embedding: number[] | null
  similarityScore: number
}

interface EqCondition {
  kind: 'eq'
  left: unknown
  right: unknown
}

interface IsNotNullCondition {
  kind: 'isNotNull'
  column: unknown
}

type Condition = EqCondition | IsNotNullCondition

interface AndCondition {
  kind: 'and'
  conditions: Condition[]
}

interface QueryState {
  selection: unknown
  from: unknown
  where: AndCondition | null
  orderBy: unknown
  limit: number | null
}

interface MockEmbeddingErrorInstance extends Error {
  readonly code: string
}

type MockEmbeddingErrorConstructor = new (
  code: string,
  message: string,
) => MockEmbeddingErrorInstance

const mocks = vi.hoisted(() => {
  class MockEmbeddingError extends Error implements MockEmbeddingErrorInstance {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'EmbeddingError'
    }
  }

  return {
    EmbeddingError: MockEmbeddingError as MockEmbeddingErrorConstructor,
    embedQuery: vi.fn<(text: string) => Promise<number[]>>(),
    rows: [] as TestChunkRow[],
    queryState: {
      selection: null,
      from: null,
      where: null,
      orderBy: null,
      limit: null,
    } as QueryState,
    columns: {
      id: 'chunks.id',
      documentId: 'chunks.documentId',
      documentVersionId: 'chunks.documentVersionId',
      organizationId: 'chunks.organizationId',
      studyId: 'chunks.studyId',
      documentType: 'chunks.documentType',
      pageStart: 'chunks.pageStart',
      pageEnd: 'chunks.pageEnd',
      sectionTitle: 'chunks.sectionTitle',
      content: 'chunks.content',
      embedding: 'chunks.embedding',
    },
    and: vi.fn((...conditions: Condition[]) => ({
      kind: 'and' as const,
      conditions,
    })),
    eq: vi.fn((left: unknown, right: unknown) => ({
      kind: 'eq' as const,
      left,
      right,
    })),
    isNotNull: vi.fn((column: unknown) => ({
      kind: 'isNotNull' as const,
      column,
    })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: 'sql' as const,
      strings: Array.from(strings),
      values,
    })),
  }
})

function createEmbedding(value = 0.1): number[] {
  return Array.from({ length: 1536 }, () => value)
}

function eqValue(where: AndCondition, left: unknown): unknown {
  return where.conditions.find((condition): condition is EqCondition => {
    return condition.kind === 'eq' && condition.left === left
  })?.right
}

function hasIsNotNull(where: AndCondition, column: unknown): boolean {
  return where.conditions.some((condition) => {
    return condition.kind === 'isNotNull' && condition.column === column
  })
}

function applyWhere(rows: readonly TestChunkRow[], where: AndCondition | null): TestChunkRow[] {
  if (!where) return [...rows]

  const organizationId = eqValue(where, mocks.columns.organizationId)
  const studyId = eqValue(where, mocks.columns.studyId)
  const documentType = eqValue(where, mocks.columns.documentType)
  const requiresEmbedding = hasIsNotNull(where, mocks.columns.embedding)

  return rows.filter((row) => {
    if (organizationId && row.organizationId !== organizationId) return false
    if (studyId && row.studyId !== studyId) return false
    if (documentType && row.documentType !== documentType) return false
    if (requiresEmbedding && row.embedding === null) return false
    return true
  })
}

function createSelectBuilder(): {
  from: (table: unknown) => {
    where: (where: AndCondition) => {
      orderBy: (orderBy: unknown) => {
        limit: (topK: number) => Promise<TestChunkRow[]>
      }
    }
  }
} {
  return {
    from: (table) => {
      mocks.queryState.from = table
      return {
        where: (where) => {
          mocks.queryState.where = where
          return {
            orderBy: (orderBy) => {
              mocks.queryState.orderBy = orderBy
              return {
                limit: async (topK) => {
                  mocks.queryState.limit = topK
                  return applyWhere(mocks.rows, mocks.queryState.where)
                    .sort((left, right) => right.similarityScore - left.similarityScore)
                    .slice(0, topK)
                },
              }
            },
          }
        },
      }
    },
  }
}

function createRow(input: {
  organizationId: string
  studyId: string
  documentType?: TestDocumentType
  embedding?: number[] | null
  similarityScore?: number
}): TestChunkRow {
  return {
    chunkId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentVersionId: crypto.randomUUID(),
    organizationId: input.organizationId,
    studyId: input.studyId,
    documentType: input.documentType ?? 'protocol',
    pageStart: 1,
    pageEnd: 1,
    sectionTitle: null,
    content: crypto.randomUUID(),
    embedding: input.embedding === undefined ? createEmbedding() : input.embedding,
    similarityScore: input.similarityScore ?? 0.9,
  }
}

vi.mock('drizzle-orm', () => ({
  and: mocks.and,
  eq: mocks.eq,
  isNotNull: mocks.isNotNull,
  sql: mocks.sql,
}))

vi.mock('@ichtys/ingestion/embedder', () => ({
  EmbeddingError: mocks.EmbeddingError,
  embedQuery: mocks.embedQuery,
}))

vi.mock('@ichtys/db', () => ({
  EMBEDDING_DIMENSIONS: 1536,
  documentType: [
    'protocol',
    'investigator_brochure',
    'lab_manual',
    'pharmacy_manual',
    'other',
  ],
  chunks: mocks.columns,
  db: {
    select: (selection: unknown) => {
      mocks.queryState.selection = selection
      return createSelectBuilder()
    },
  },
}))

import {
  RetrievalError,
  embedRetrievalQuery,
  retrieveRelevantChunks,
} from '../retriever'

describe('embedRetrievalQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows.length = 0
    mocks.queryState = {
      selection: null,
      from: null,
      where: null,
      orderBy: null,
      limit: null,
    }
  })

  it('generates a 1536-dimension query embedding', async () => {
    mocks.embedQuery.mockResolvedValue(createEmbedding())

    const embedding = await embedRetrievalQuery('eligibility criteria')

    expect(embedding).toHaveLength(1536)
    expect(mocks.embedQuery).toHaveBeenCalledWith('eligibility criteria', { openAiApiKey: undefined })
  })

  it('sanitizes provider errors without logging the query text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const queryText = 'patient private screening question'
    mocks.embedQuery.mockRejectedValue(
      new mocks.EmbeddingError('embedding_rate_limited', `raw provider details for ${queryText}`),
    )

    await expect(embedRetrievalQuery(queryText)).rejects.toMatchObject({
      code: 'embedding_rate_limited',
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('rejects query embeddings with the wrong dimension', async () => {
    mocks.embedQuery.mockResolvedValue([0.1])

    await expect(embedRetrievalQuery('eligibility criteria')).rejects.toBeInstanceOf(RetrievalError)
    await expect(embedRetrievalQuery('eligibility criteria')).rejects.toMatchObject({
      code: 'embedding_dimension_mismatch',
    })
  })
})

describe('retrieveRelevantChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows.length = 0
    mocks.queryState = {
      selection: null,
      from: null,
      where: null,
      orderBy: null,
      limit: null,
    }
    mocks.embedQuery.mockResolvedValue(createEmbedding())
  })

  it('filters by orgId and studyId inside the vector query', async () => {
    const orgId = crypto.randomUUID()
    const studyId = crypto.randomUUID()
    const otherOrgId = crypto.randomUUID()
    const otherStudyId = crypto.randomUUID()
    const expected = createRow({ organizationId: orgId, studyId, similarityScore: 0.95 })
    const otherOrg = createRow({ organizationId: otherOrgId, studyId, similarityScore: 0.99 })
    const otherStudy = createRow({ organizationId: orgId, studyId: otherStudyId, similarityScore: 0.98 })
    mocks.rows.push(expected, otherOrg, otherStudy)

    const results = await retrieveRelevantChunks({
      queryText: 'eligibility',
      orgId,
      studyId,
      topK: 8,
    })

    expect(results).toEqual([
      expect.objectContaining({
        chunkId: expected.chunkId,
        documentId: expected.documentId,
        documentVersionId: expected.documentVersionId,
        similarityScore: expected.similarityScore,
      }),
    ])
    expect(mocks.queryState.where).toMatchObject({
      kind: 'and',
      conditions: expect.arrayContaining([
        { kind: 'eq', left: mocks.columns.organizationId, right: orgId },
        { kind: 'eq', left: mocks.columns.studyId, right: studyId },
        { kind: 'isNotNull', column: mocks.columns.embedding },
      ]),
    })
    expect(mocks.queryState.orderBy).toBeDefined()
  })

  it('respects topK in the database query', async () => {
    const orgId = crypto.randomUUID()
    const studyId = crypto.randomUUID()
    mocks.rows.push(
      createRow({ organizationId: orgId, studyId, similarityScore: 0.95 }),
      createRow({ organizationId: orgId, studyId, similarityScore: 0.9 }),
      createRow({ organizationId: orgId, studyId, similarityScore: 0.85 }),
    )

    const results = await retrieveRelevantChunks({
      queryText: 'lab procedures',
      orgId,
      studyId,
      topK: 2,
    })

    expect(results).toHaveLength(2)
    expect(mocks.queryState.limit).toBe(2)
  })

  it('respects optional documentType filtering inside the query', async () => {
    const orgId = crypto.randomUUID()
    const studyId = crypto.randomUUID()
    const labManual = createRow({
      organizationId: orgId,
      studyId,
      documentType: 'lab_manual',
      similarityScore: 0.95,
    })
    mocks.rows.push(
      createRow({ organizationId: orgId, studyId, documentType: 'protocol', similarityScore: 0.99 }),
      labManual,
    )

    const results = await retrieveRelevantChunks({
      queryText: 'sample processing',
      orgId,
      studyId,
      topK: 8,
      documentType: 'lab_manual',
    })

    expect(results).toEqual([
      expect.objectContaining({
        chunkId: labManual.chunkId,
        documentType: 'lab_manual',
      }),
    ])
    expect(mocks.queryState.where).toMatchObject({
      conditions: expect.arrayContaining([
        { kind: 'eq', left: mocks.columns.documentType, right: 'lab_manual' },
      ]),
    })
  })

  it('ignores chunks without embeddings in the database query', async () => {
    const orgId = crypto.randomUUID()
    const studyId = crypto.randomUUID()
    const embedded = createRow({ organizationId: orgId, studyId, similarityScore: 0.9 })
    const unembedded = createRow({
      organizationId: orgId,
      studyId,
      embedding: null,
      similarityScore: 0.99,
    })
    mocks.rows.push(unembedded, embedded)

    const results = await retrieveRelevantChunks({
      queryText: 'safety reporting',
      orgId,
      studyId,
      topK: 8,
    })

    expect(results.map((chunk) => chunk.chunkId)).toEqual([embedded.chunkId])
    expect(mocks.isNotNull).toHaveBeenCalledWith(mocks.columns.embedding)
  })

  it('returns an empty list when no chunks match the tenant boundary', async () => {
    const orgId = crypto.randomUUID()
    const studyId = crypto.randomUUID()
    mocks.rows.push(
      createRow({
        organizationId: crypto.randomUUID(),
        studyId: crypto.randomUUID(),
        similarityScore: 0.99,
      }),
    )

    const results = await retrieveRelevantChunks({
      queryText: 'concomitant medication',
      orgId,
      studyId,
      topK: 8,
    })

    expect(results).toEqual([])
  })
})
