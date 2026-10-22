import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ExistingRow {
  pageStart: number
  pageEnd: number
  content: string
  embedded: boolean
}

const state = vi.hoisted(() => ({
  existing: [] as ExistingRow[],
  lastMetadata: null as unknown,
  wheres: [] as { table: unknown; condition: unknown }[],
  fingerprint: 'google:gemini-embedding-001',
  tables: {
    chunks: {
      pageStart: 'chunks.pageStart',
      pageEnd: 'chunks.pageEnd',
      content: 'chunks.content',
      embedding: 'chunks.embedding',
      documentVersionId: 'chunks.documentVersionId',
      documentId: 'chunks.documentId',
      organizationId: 'chunks.organizationId',
      studyId: 'chunks.studyId',
    },
    auditLogs: {
      metadata: 'auditLogs.metadata',
      organizationId: 'auditLogs.organizationId',
      studyId: 'auditLogs.studyId',
      action: 'auditLogs.action',
      resourceId: 'auditLogs.resourceId',
      createdAt: 'auditLogs.createdAt',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (left: unknown, right: unknown) => ({ left, right }),
  desc: (column: unknown) => ({ desc: column }),
  sql: (...parts: unknown[]) => ({ sql: parts }),
}))

vi.mock('../embedding-config', () => ({
  getEmbeddingFingerprint: () => state.fingerprint,
}))

vi.mock('@ichtys/db', () => ({
  chunks: state.tables.chunks,
  auditLogs: state.tables.auditLogs,
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          state.wheres.push({ table, condition })
          if (table === state.tables.chunks) return Promise.resolve(state.existing)
          return {
            orderBy: () => ({
              limit: async () => (state.lastMetadata === null ? [] : [{ metadata: state.lastMetadata }]),
            }),
          }
        },
      }),
    }),
  },
}))

import { canReuseEmbeddedChunks } from '../chunk-reuse'

const ctx = {
  orgId: crypto.randomUUID(),
  studyId: crypto.randomUUID(),
  documentId: crypto.randomUUID(),
  documentVersionId: crypto.randomUUID(),
}

const first = { pageStart: 1, pageEnd: 1, content: 'criterios de inclusion sinteticos' }
const second = { pageStart: 2, pageEnd: 3, content: 'procedimientos sinteticos' }
const incoming = [first, second]

beforeEach(() => {
  state.wheres.length = 0
  state.fingerprint = 'google:gemini-embedding-001'
  state.lastMetadata = { embeddingFingerprint: 'google:gemini-embedding-001' }
  state.existing = incoming.map((chunk, i) => ({ ...chunk, embedded: i === 0 }))
})

describe('canReuseEmbeddedChunks', () => {
  it('reutiliza cuando los fragmentos son los mismos, hay alguno embebido y el modelo coincide', async () => {
    await expect(canReuseEmbeddedChunks(ctx, incoming)).resolves.toBe(true)
  })

  it('no reutiliza si el modelo de embeddings cambió (no se mezclan espacios vectoriales)', async () => {
    state.fingerprint = 'openai:text-embedding-3-small'
    await expect(canReuseEmbeddedChunks(ctx, incoming)).resolves.toBe(false)
  })

  it('no reutiliza si no hay registro de qué modelo se usó (corrida anterior sin huella)', async () => {
    state.lastMetadata = null
    await expect(canReuseEmbeddedChunks(ctx, incoming)).resolves.toBe(false)

    state.lastMetadata = { documentId: 'x' }
    await expect(canReuseEmbeddedChunks(ctx, incoming)).resolves.toBe(false)
  })

  it('no reutiliza si ningún fragmento está embebido todavía', async () => {
    state.existing = incoming.map((chunk) => ({ ...chunk, embedded: false }))
    await expect(canReuseEmbeddedChunks(ctx, incoming)).resolves.toBe(false)
  })

  it('no reutiliza si el contenido de algún fragmento cambió', async () => {
    const changed = [first, { ...second, content: 'procedimientos MODIFICADOS' }]
    state.existing = changed.map((chunk) => ({ ...chunk, embedded: true }))
    await expect(canReuseEmbeddedChunks(ctx, incoming)).resolves.toBe(false)
  })

  it('no reutiliza si cambió la cantidad de fragmentos', async () => {
    state.existing = [{ ...first, embedded: true }]
    await expect(canReuseEmbeddedChunks(ctx, incoming)).resolves.toBe(false)
  })

  it('no reutiliza si el PDF no produjo fragmentos', async () => {
    await expect(canReuseEmbeddedChunks(ctx, [])).resolves.toBe(false)
  })
})

describe('canReuseEmbeddedChunks: aislamiento multi-tenant', () => {
  function equalities(condition: unknown): { left: unknown; right: unknown }[] {
    const parts = (condition as { conditions?: unknown[] }).conditions ?? []
    return parts as { left: unknown; right: unknown }[]
  }

  it('las dos consultas filtran por organizacion y estudio, ademas del documento/version', async () => {
    await canReuseEmbeddedChunks(ctx, incoming)

    const chunkWhere = state.wheres.find((w) => w.table === state.tables.chunks)
    const auditWhere = state.wheres.find((w) => w.table === state.tables.auditLogs)
    expect(chunkWhere).toBeDefined()
    expect(auditWhere).toBeDefined()

    const chunkEq = equalities(chunkWhere?.condition)
    expect(chunkEq).toContainEqual({ left: 'chunks.organizationId', right: ctx.orgId })
    expect(chunkEq).toContainEqual({ left: 'chunks.studyId', right: ctx.studyId })
    expect(chunkEq).toContainEqual({ left: 'chunks.documentId', right: ctx.documentId })
    expect(chunkEq).toContainEqual({ left: 'chunks.documentVersionId', right: ctx.documentVersionId })

    const auditEq = equalities(auditWhere?.condition)
    expect(auditEq).toContainEqual({ left: 'auditLogs.organizationId', right: ctx.orgId })
    expect(auditEq).toContainEqual({ left: 'auditLogs.studyId', right: ctx.studyId })
    expect(auditEq).toContainEqual({ left: 'auditLogs.resourceId', right: ctx.documentVersionId })
    expect(auditEq).toContainEqual({ left: 'auditLogs.action', right: 'embeddings.started' })
  })
})
