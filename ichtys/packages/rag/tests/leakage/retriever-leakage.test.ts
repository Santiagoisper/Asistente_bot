import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Leakage suite — retrieval tenant isolation (SECURITY.md §5, §11).
 *
 * Bloqueante para release. Verifica que retrieveRelevantChunks():
 *  1. nunca devuelve chunks de otra organización (cross-tenant, target 0%),
 *  2. nunca devuelve chunks de otro estudio dentro de la misma org (cross-study),
 *  3. arma el WHERE con organization_id + study_id + embedding IS NOT NULL
 *     ANTES del ordenamiento vectorial, en todas las variantes de filtro.
 *
 * Usa el mismo harness de mocks que __tests__/retriever.test.ts: el WHERE
 * capturado se aplica sobre las filas seed, de modo que si el código dejara
 * de filtrar por tenant, las filas de otra org aparecerían y el test fallaría.
 */

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

const mocks = vi.hoisted(() => {
  class MockEmbeddingError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'EmbeddingError'
    }
  }

  return {
    EmbeddingError: MockEmbeddingError,
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
  content?: string
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
    content: input.content ?? crypto.randomUUID(),
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

import { retrieveRelevantChunks } from '../../retriever'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const STUDY_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STUDY_Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('leakage — cross-tenant retrieval isolation', () => {
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

  it('never returns chunks belonging to another organization', async () => {
    const orgBContent = 'SECRETO-ORG-B-nunca-debe-aparecer'
    mocks.rows.push(
      createRow({ organizationId: ORG_A, studyId: STUDY_X, similarityScore: 0.5 }),
      // Chunk de otra org con score MÁS alto: si el filtro fallara, ganaría el ranking.
      createRow({
        organizationId: ORG_B,
        studyId: STUDY_X,
        similarityScore: 0.99,
        content: orgBContent,
      }),
    )

    const result = await retrieveRelevantChunks({
      queryText: 'criterios de elegibilidad',
      orgId: ORG_A,
      studyId: STUDY_X,
    })

    expect(result.length).toBe(1)
    for (const chunk of result) {
      expect(chunk.content).not.toContain(orgBContent)
    }
  })

  it('never returns chunks from another study within the same organization', async () => {
    const studyYContent = 'SECRETO-STUDY-Y-nunca-debe-aparecer'
    mocks.rows.push(
      createRow({ organizationId: ORG_A, studyId: STUDY_X, similarityScore: 0.4 }),
      createRow({
        organizationId: ORG_A,
        studyId: STUDY_Y,
        similarityScore: 0.99,
        content: studyYContent,
      }),
    )

    const result = await retrieveRelevantChunks({
      queryText: 'manejo de muestras PK',
      orgId: ORG_A,
      studyId: STUDY_X,
    })

    expect(result.length).toBe(1)
    for (const chunk of result) {
      expect(chunk.content).not.toContain(studyYContent)
    }
  })

  it('builds the SQL WHERE with organization_id, study_id and embedding IS NOT NULL', async () => {
    mocks.rows.push(createRow({ organizationId: ORG_A, studyId: STUDY_X }))

    await retrieveRelevantChunks({
      queryText: 'medicación concomitante',
      orgId: ORG_A,
      studyId: STUDY_X,
    })

    const where = mocks.queryState.where
    expect(where).not.toBeNull()
    expect(eqValue(where as AndCondition, mocks.columns.organizationId)).toBe(ORG_A)
    expect(eqValue(where as AndCondition, mocks.columns.studyId)).toBe(STUDY_X)
    expect(hasIsNotNull(where as AndCondition, mocks.columns.embedding)).toBe(true)
  })

  it('keeps tenant filters when a documentType filter is applied', async () => {
    mocks.rows.push(
      createRow({ organizationId: ORG_A, studyId: STUDY_X, documentType: 'protocol' }),
      createRow({ organizationId: ORG_B, studyId: STUDY_X, documentType: 'protocol' }),
    )

    const result = await retrieveRelevantChunks({
      queryText: 'timeline SAE',
      orgId: ORG_A,
      studyId: STUDY_X,
      documentType: 'protocol',
    })

    const where = mocks.queryState.where
    expect(eqValue(where as AndCondition, mocks.columns.organizationId)).toBe(ORG_A)
    expect(eqValue(where as AndCondition, mocks.columns.studyId)).toBe(STUDY_X)
    expect(result.every((chunk) => chunk.documentType === 'protocol')).toBe(true)
    expect(result.length).toBe(1)
  })

  it('never returns chunks without embeddings (not yet indexed)', async () => {
    mocks.rows.push(
      createRow({ organizationId: ORG_A, studyId: STUDY_X, embedding: null }),
      createRow({ organizationId: ORG_A, studyId: STUDY_X }),
    )

    const result = await retrieveRelevantChunks({
      queryText: 'visita 4',
      orgId: ORG_A,
      studyId: STUDY_X,
    })

    expect(result.length).toBe(1)
  })
})
