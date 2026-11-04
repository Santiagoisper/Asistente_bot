import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateStudyAccess: vi.fn(),
  handleApiError: vi.fn<(err: unknown) => Response>((err: unknown) => {
    if (err instanceof Error && err.name === 'AccessError' && 'status' in err) {
      const status = (err as { status: number }).status
      if (status === 401 || status === 403 || status === 404) {
        const body = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not Found'
        return new Response(body, { status })
      }
    }
    return new Response('Internal Server Error', { status: 500 })
  }),
  putPrivateDocumentPdf: vi.fn(),
  enforceSlidingWindowRateLimit: vi.fn(),
  getUploadRateLimitConfig: vi.fn().mockReturnValue({ limit: 10, windowSeconds: 60 }),
  rateLimitResponse: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@ichtys/auth', async () => {
  const roles = await vi.importActual<typeof import('@ichtys/auth/roles')>('@ichtys/auth/roles')
  return {
    validateStudyAccess: mocks.validateStudyAccess,
    handleApiError: mocks.handleApiError,
    canManageDocuments: roles.canManageDocuments,
    normalizeRole: roles.normalizeRole,
    AccessError: class AccessError extends Error {
      readonly status: 401 | 403 | 404
      constructor(message: string, status: 401 | 403 | 404) {
        super(message)
        this.name = 'AccessError'
        this.status = status
      }
    },
  }
})

vi.mock('@ichtys/db', () => ({
  db: { transaction: (...args: [unknown]) => mocks.transaction(...args) },
  documents: { _: { name: 'documents' } },
  documentVersions: { _: { name: 'document_versions' } },
  auditLogs: { _: { name: 'audit_logs' } },
}))

vi.mock('../blob-storage', () => ({
  putPrivateDocumentPdf: mocks.putPrivateDocumentPdf,
}))

vi.mock('../../../../../lib/security/rate-limit', () => ({
  enforceSlidingWindowRateLimit: mocks.enforceSlidingWindowRateLimit,
  getUploadRateLimitConfig: mocks.getUploadRateLimitConfig,
  rateLimitResponse: mocks.rateLimitResponse,
}))

// El logger real es puro; solo silenciamos la salida.
vi.mock('../../../../../lib/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../../../lib/observability/logger')
  >()
  return { ...actual, log: vi.fn() }
})

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STUDY_ID = crypto.randomUUID()
const ORG_ID = crypto.randomUUID()

function pdfFile(name = 'protocolo.pdf'): File {
  const bytes = new TextEncoder().encode('%PDF-1.4 sintetico')
  return new File([bytes], name, { type: 'application/pdf' })
}

function uploadRequest(file: File = pdfFile()): Request {
  const form = new FormData()
  form.set('studyId', STUDY_ID)
  form.set('documentType', 'protocol')
  form.set('file', file)
  return new Request('http://localhost/api/documents/upload', { method: 'POST', body: form })
}

function documentRow() {
  return {
    id: crypto.randomUUID(),
    name: 'protocolo.pdf',
    documentType: 'protocol',
  }
}

function versionRow(documentId: string) {
  return {
    id: crypto.randomUUID(),
    documentId,
    status: 'pending',
  }
}

/** Inserts: 1) documents (returning) 2) documentVersions (returning) 3) auditLogs (await). */
function mockTransaction() {
  const document = documentRow()
  const version = versionRow(document.id)
  const insert = vi
    .fn()
    .mockReturnValueOnce({ values: () => ({ returning: async () => [document] }) })
    .mockReturnValueOnce({ values: () => ({ returning: async () => [version] }) })
    .mockReturnValueOnce({ values: async () => undefined })
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ insert }))
  return { document, version }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUploadRateLimitConfig.mockReturnValue({ limit: 10, windowSeconds: 60 })
  mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: false })
  mocks.validateStudyAccess.mockResolvedValue({
    userId: 'user_test',
    orgId: ORG_ID,
    study: { id: STUDY_ID, name: 'Estudio' },
    role: 'site_coordinator',
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// P1-6: fallo de almacenamiento
// ---------------------------------------------------------------------------

describe('POST /api/documents/upload — fallo de almacenamiento (P1-6)', () => {
  it('devuelve 502 con mensaje en español cuando el blob falla, sin tocar la DB', async () => {
    mocks.putPrivateDocumentPdf.mockRejectedValueOnce(new Error('Vercel Blob: store unavailable'))

    const res = await POST(uploadRequest())

    expect(res.status).toBe(502)
    expect(await res.text()).toBe(
      'No se pudo guardar el archivo en el almacenamiento. Intentá de nuevo en unos segundos.',
    )
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.handleApiError).not.toHaveBeenCalled()
  })

  it('no filtra detalles internos del SDK en la respuesta', async () => {
    mocks.putPrivateDocumentPdf.mockRejectedValueOnce(
      new Error('Vercel Blob: https://s.private.blob/x/Juan_Perez.pdf 500'),
    )

    const res = await POST(uploadRequest())
    const text = await res.text()

    expect(res.status).toBe(502)
    expect(text).not.toContain('Vercel Blob')
    expect(text).not.toContain('Juan_Perez')
  })
})

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

describe('POST /api/documents/upload — camino feliz', () => {
  it('devuelve 202 con documentId y documentVersionId cuando el blob y la DB funcionan', async () => {
    const { document, version } = mockTransaction()
    mocks.putPrivateDocumentPdf.mockResolvedValueOnce({
      url: 'https://s.private.blob/x/protocolo.pdf',
      pathname: 'x/protocolo.pdf',
    })

    const res = await POST(uploadRequest())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(202)
    expect(body.documentId).toBe(document.id)
    expect(body.documentVersionId).toBe(version.id)
    expect(mocks.putPrivateDocumentPdf).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/documents/upload — gestión documental (S1)', () => {
  it.each(['read_only_monitor', 'principal_investigator'])(
    'rechaza a %s con 403 y no guarda el PDF',
    async (role) => {
      mockTransaction()
      mocks.putPrivateDocumentPdf.mockResolvedValue({
        url: 'https://s.private.blob/x/protocolo.pdf',
        pathname: 'x/protocolo.pdf',
      })
      mocks.validateStudyAccess.mockResolvedValue({
        userId: 'user_test',
        orgId: ORG_ID,
        study: { id: STUDY_ID, name: 'Estudio' },
        role,
      })

      const res = await POST(uploadRequest())

      expect(res.status).toBe(403)
      expect(await res.text()).toBe('Forbidden')
      expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
    },
  )
})
