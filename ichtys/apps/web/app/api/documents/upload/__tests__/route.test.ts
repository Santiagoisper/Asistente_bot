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
  getUploadRateLimitConfig: vi.fn().mockReturnValue({ limit: 10, orgLimit: 40, windowSeconds: 60 }),
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
  rateLimitUnavailableResponse: () =>
    Response.json(
      { error: 'rate_limit_unavailable', message: 'No se pudo verificar el cupo. Probá de nuevo en unos minutos.' },
      { status: 503, headers: { 'Retry-After': '60' } },
    ),
}))

// El logger real es puro; solo silenciamos la salida.
vi.mock('../../../../../lib/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../../../lib/observability/logger')
  >()
  return { ...actual, log: vi.fn() }
})

import { MAX_UPLOAD_BODY_BYTES } from '../../../../../lib/documents/pdf-upload-validation'
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

function uploadRequest(file: File = pdfFile(), studyId = STUDY_ID): Request {
  const form = new FormData()
  form.set('studyId', studyId)
  form.set('documentType', 'protocol')
  form.set('file', file)
  return new Request(
    `http://localhost/api/documents/upload?studyId=${encodeURIComponent(studyId)}`,
    { method: 'POST', body: form },
  )
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
  mocks.getUploadRateLimitConfig.mockReturnValue({ limit: 10, orgLimit: 40, windowSeconds: 60 })
  mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: false })
  mocks.validateStudyAccess.mockResolvedValue({
    userId: 'user_test',
    orgId: ORG_ID,
    study: { id: STUDY_ID, name: 'Estudio' },
    role: 'site_coordinator',
    access: { mode: 'open', role: 'site_coordinator', functions: [] },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// P1-6: fallo de almacenamiento
// ---------------------------------------------------------------------------

describe('POST /api/documents/upload — cupo', () => {
  it('responde 503 y no guarda el PDF si no se puede verificar el cupo', async () => {
    mocks.enforceSlidingWindowRateLimit.mockResolvedValueOnce({
      limited: true,
      retryAfterSeconds: 60,
      reason: 'unavailable',
    })

    const res = await POST(uploadRequest())

    expect(res.status).toBe(503)
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

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

describe('POST /api/documents/upload — G14-53-1 acceso antes del archivo', () => {
  it('responde 403 sin parsear ni leer el cuerpo si el rol no gestiona documentos', async () => {
    mocks.validateStudyAccess.mockResolvedValue({
      userId: 'user_test',
      orgId: ORG_ID,
      study: { id: STUDY_ID, name: 'Estudio' },
      role: 'read_only_monitor',
      access: { mode: 'open', role: 'read_only_monitor', functions: [] },
    })
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(1024))
      },
    })
    const req = new Request(`http://localhost/api/documents/upload?studyId=${STUDY_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----ficticio' },
      body,
      duplex: 'half',
    } as RequestInit)
    const formData = vi.spyOn(req, 'formData')

    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
    expect(formData).not.toHaveBeenCalled()
    expect(req.bodyUsed).toBe(false)
    expect(pulls).toBeLessThanOrEqual(1)
    expect(mocks.validateStudyAccess).toHaveBeenCalledWith(STUDY_ID)
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rechaza un Content-Length enorme sin leer el formulario ni guardar', async () => {
    const req = new Request(`http://localhost/api/documents/upload?studyId=${STUDY_ID}`, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=----ficticio',
        'content-length': String(1_000_000_000),
      },
      body: '------ficticio--\r\n',
    })
    const formData = vi.spyOn(req, 'formData')

    const res = await POST(req)

    expect(res.status).toBe(413)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('lee el PDF real aunque el Content-Length diga 1', async () => {
    const { document, version } = mockTransaction()
    mocks.putPrivateDocumentPdf.mockResolvedValueOnce({
      url: 'https://s.private.blob/x/protocolo.pdf',
      pathname: 'x/protocolo.pdf',
    })
    const boundary = '----ficticio'
    const fileBytes = new TextEncoder().encode('%PDF-1.4 sintetico')
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="studyId"\r\n\r\n${STUDY_ID}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\nprotocol\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="protocolo.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    )
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
    const body = new Uint8Array(head.length + fileBytes.length + tail.length)
    body.set(head, 0)
    body.set(fileBytes, head.length)
    body.set(tail, head.length + fileBytes.length)
    const req = new Request(`http://localhost/api/documents/upload?studyId=${STUDY_ID}`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': '1',
      },
      body,
    })

    const res = await POST(req)
    const payload = (await res.json()) as { documentId?: string; documentVersionId?: string }

    expect(res.status).toBe(202)
    expect(payload.documentId).toBe(document.id)
    expect(payload.documentVersionId).toBe(version.id)
    expect(mocks.putPrivateDocumentPdf).toHaveBeenCalledTimes(1)
  })

  it('cancela un stream que supera el tope aunque el Content-Length diga 1', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk.slice())
        sent += chunk.byteLength
      },
      cancel() {
        cancelled = true
      },
    })
    const req = new Request(`http://localhost/api/documents/upload?studyId=${STUDY_ID}`, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=----ficticio',
        'content-length': '1',
      },
      body,
      duplex: 'half',
    } as RequestInit)
    const formData = vi.spyOn(req, 'formData')

    const res = await POST(req)

    expect(res.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(sent).toBeLessThanOrEqual(MAX_UPLOAD_BODY_BYTES + 4 * chunk.byteLength)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  }, 30_000)
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
        access: { mode: 'open', role, functions: [] },
      })

      const res = await POST(uploadRequest())

      expect(res.status).toBe(403)
      expect(await res.text()).toBe('Forbidden')
      expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
    },
  )
})

describe('POST /api/documents/upload — modo estricto', () => {
  const context = (role: string, functions: string[]) => ({
    userId: 'user_test',
    orgId: ORG_ID,
    study: { id: STUDY_ID, name: 'Estudio' },
    role,
    access: { mode: 'enforced', role, functions },
  })

  it('el rol más alto, sin una función que gestione documentos, no sube el PDF', async () => {
    mockTransaction()
    mocks.validateStudyAccess.mockResolvedValue(context('org_admin', ['investigator', 'lab_assistant']))

    const res = await POST(uploadRequest())

    expect(res.status).toBe(403)
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('el asistente de regulatorio sube el PDF aunque su rol histórico no gestionara documentos', async () => {
    mockTransaction()
    mocks.putPrivateDocumentPdf.mockResolvedValue({
      url: 'https://s.private.blob/x/protocolo.pdf',
      pathname: 'x/protocolo.pdf',
    })
    mocks.validateStudyAccess.mockResolvedValue(context('principal_investigator', ['regulatory_assistant']))

    const res = await POST(uploadRequest())

    expect(res.status).not.toBe(403)
    expect(mocks.putPrivateDocumentPdf).toHaveBeenCalledTimes(1)
  })
})
