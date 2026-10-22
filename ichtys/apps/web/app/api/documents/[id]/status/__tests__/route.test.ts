import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
  }
  return {
    validateDocumentAccess: vi.fn(),
    // Instancia fresca por llamada: una Response compartida muere al leer el body dos veces.
    handleApiError: vi
      .fn()
      .mockImplementation(() => new Response('Internal Server Error', { status: 500 })),
    findFirst: vi.fn(),
    select: vi.fn().mockReturnValue(selectChain),
    selectChain,
  }
})

vi.mock('@ichtys/auth', () => ({
  validateDocumentAccess: mocks.validateDocumentAccess,
  handleApiError: mocks.handleApiError,
}))

vi.mock('@ichtys/db', () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, value: unknown) => [col, value],
  isNotNull: (col: unknown) => [col],
  count: () => 'count()',
  // Schemas como objetos planos: solo se acceden columnas por nombre.
  pages: { documentVersionId: 'pages.documentVersionId', organizationId: 'pages.organizationId' },
  chunks: {
    documentVersionId: 'chunks.documentVersionId',
    organizationId: 'chunks.organizationId',
    embedding: 'chunks.embedding',
  },
  db: {
    query: { documentVersions: { findFirst: mocks.findFirst } },
    select: mocks.select,
  },
}))

import { GET } from '../route'

const ORG_ID = crypto.randomUUID()
const STUDY_ID = crypto.randomUUID()
const DOC_ID = crypto.randomUUID()

function makeContext() {
  const req = new Request(`http://localhost/api/documents/${DOC_ID}/status`)
  const params = Promise.resolve({ id: DOC_ID })
  return { req, params }
}

function stubVersion(version: Record<string, unknown>) {
  mocks.findFirst.mockResolvedValue({
    id: crypto.randomUUID(),
    organizationId: ORG_ID,
    studyId: STUDY_ID,
    versionNumber: 1,
    createdAt: new Date('2026-10-22T10:00:00Z'),
    ...version,
  })
  mocks.validateDocumentAccess.mockResolvedValue({
    orgId: ORG_ID,
    studyId: STUDY_ID,
    document: { id: DOC_ID, documentType: 'protocol', organizationId: ORG_ID, studyId: STUDY_ID },
  })
}

/** Los tres counts en orden: [pages, chunksTotal, chunksEmbedded]. */
function stubCounts(values: [number, number, number]) {
  for (const value of values) {
    mocks.selectChain.where.mockResolvedValueOnce([{ value }])
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/documents/[id]/status — etapa real de la ingesta', () => {
  it('versión pending → stage queued con etiqueta en español', async () => {
    stubVersion({ status: 'pending', pageCount: null, errorMessage: null })
    stubCounts([0, 0, 0])

    const res = await GET(makeContext().req, makeContext())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.stage).toBe('queued')
    expect(body.stageLabel).toMatch(/cola/i)
    expect(body.status).toBe('pending')
  })

  it('processing a mitad de embeddings → stage indexing con contadores expuestos', async () => {
    stubVersion({ status: 'processing', pageCount: 40, errorMessage: null })
    stubCounts([40, 120, 30])

    const res = await GET(makeContext().req, makeContext())
    const body = await res.json()

    expect(body.stage).toBe('indexing')
    expect(body.pagesIndexed).toBe(40)
    expect(body.chunksTotal).toBe(120)
    expect(body.chunksEmbedded).toBe(30)
    expect(body.documentType).toBe('protocol')
  })

  it('processing con embeddings completos en protocolo → stage extracting (SoA)', async () => {
    stubVersion({ status: 'processing', pageCount: 40, errorMessage: null })
    stubCounts([40, 120, 120])

    const res = await GET(makeContext().req, makeContext())
    expect((await res.json()).stage).toBe('extracting')
  })

  it('error → mensaje en español mapeado del código interno, nunca el código crudo', async () => {
    stubVersion({ status: 'error', pageCount: null, errorMessage: 'pdf_contains_no_extractable_text' })
    stubCounts([0, 0, 0])

    const res = await GET(makeContext().req, makeContext())
    const body = await res.json()

    expect(body.stage).toBe('error')
    expect(body.errorMessage).toMatch(/escaneado|texto/i)
    expect(body.errorMessage).not.toContain('pdf_contains_no_extractable_text')
  })

  it('id no-uuid → 400 sin tocar la DB', async () => {
    const req = new Request('http://localhost/api/documents/no-es-uuid/status')
    const res = await GET(req, { params: Promise.resolve({ id: 'no-es-uuid' }) })
    expect(res.status).toBe(400)
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it('documento sin versión → error de API (500)', async () => {
    mocks.validateDocumentAccess.mockResolvedValue({
      orgId: ORG_ID,
      studyId: STUDY_ID,
      document: { id: DOC_ID, documentType: 'other', organizationId: ORG_ID, studyId: STUDY_ID },
    })
    mocks.findFirst.mockResolvedValue(undefined)

    const res = await GET(makeContext().req, makeContext())
    expect(res.status).toBe(500)
    expect(mocks.handleApiError).toHaveBeenCalled()
  })
})
