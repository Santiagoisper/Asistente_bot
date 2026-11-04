import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveOrProvisionOrganization: vi.fn(),
  putPrivateDocumentPdf: vi.fn(),
  enforceSlidingWindowRateLimit: vi.fn(),
  getUploadRateLimitConfig: vi.fn().mockReturnValue({ limit: 10, windowSeconds: 60 }),
  rateLimitResponse: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  after: vi.fn(),
  runSingleIngestionJobById: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))

vi.mock('@ichtys/auth', async () => {
  const roles = await vi.importActual<typeof import('@ichtys/auth/roles')>('@ichtys/auth/roles')
  return {
    canManageDocuments: roles.canManageDocuments,
    canAdministerStudy: roles.canAdministerStudy,
    normalizeRole: roles.normalizeRole,
    resolveOrProvisionOrganization: mocks.resolveOrProvisionOrganization,
  }
})

vi.mock('next/server', () => ({ after: mocks.after }))

vi.mock('../../../documents/upload/blob-storage', () => ({
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

vi.mock('../../../../../lib/observability/logger', () => ({
  getOrCreateRequestId: () => 'req-ficticio',
  log: vi.fn(),
  makeRecord: (record: unknown) => record,
}))

vi.mock('@ichtys/db', () => ({
  db: {
    insert: (...args: unknown[]) => mocks.insert(...args),
    transaction: (cb: (tx: { insert: typeof mocks.insert }) => unknown) => mocks.transaction(cb),
  },
  studies: {},
  documents: {},
  documentVersions: {},
  ingestionJobs: { id: 'ingestionJobs.id' },
  auditLogs: {},
}))

vi.mock('@ichtys/ingestion/ingestion-jobs', () => ({
  runSingleIngestionJobById: mocks.runSingleIngestionJobById,
}))

import { POST } from '../route'

function bulkRequest(): Request {
  const bytes = new TextEncoder().encode('%PDF-1.4 protocolo ficticio')
  const file = new File([bytes], 'protocolo-ficticio.pdf', { type: 'application/pdf' })
  const form = new FormData()
  form.append('files', file)
  return new Request('http://localhost/api/studies/bulk-import', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUploadRateLimitConfig.mockReturnValue({ limit: 10, windowSeconds: 60 })
  mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: false })
  mocks.resolveOrProvisionOrganization.mockResolvedValue({ id: 'org-interna' })
  mocks.putPrivateDocumentPdf.mockResolvedValue({
    url: 'https://blob.example/protocolo-ficticio.pdf',
    pathname: 'clinical-documents/protocolo-ficticio.pdf',
  })
  mocks.insert.mockReturnValue({
    values: () => ({ returning: async () => [{ id: 'job-err' }] }),
  })
  mocks.transaction.mockImplementation(async (cb: (tx: { insert: () => unknown }) => unknown) => {
    const insert = () => ({ values: () => ({ returning: async () => [{ id: 'row-1' }] }) })
    return cb({ insert })
  })
})

describe('POST /api/studies/bulk-import — gestión documental (S1)', () => {
  it.each([
    ['org:read_only_monitor', 'read_only_monitor'],
    ['org:principal_investigator', 'principal_investigator'],
  ])('rechaza a %s antes de guardar PDFs', async (orgRole) => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole })

    const res = await POST(bulkRequest())

    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('rechaza a un coordinador de sede antes de crear estudios o guardar PDFs', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:site_coordinator',
    })

    const res = await POST(bulkRequest())

    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('deja importar el lote a un administrador del estudio', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:study_admin',
    })

    const res = await POST(bulkRequest())

    expect(res.status).toBe(202)
    expect(mocks.putPrivateDocumentPdf).toHaveBeenCalledTimes(1)
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
})

function requestWithFile(file: File): Request {
  const form = new FormData()
  form.append('files', file)
  return new Request('http://localhost/api/studies/bulk-import', { method: 'POST', body: form })
}

describe('POST /api/studies/bulk-import — cupo', () => {
  it('responde 503 y no crea estudios ni blobs si no se puede verificar el cupo', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:study_admin',
    })
    mocks.enforceSlidingWindowRateLimit.mockResolvedValueOnce({
      limited: true,
      retryAfterSeconds: 60,
      reason: 'unavailable',
    })

    const res = await POST(bulkRequest())

    expect(res.status).toBe(503)
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })
})

describe('S5 — tamaño total del lote antes de leer el cuerpo', () => {
  it('rechaza un Content-Length enorme sin leer el formulario ni crear recursos', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:study_admin',
    })
    const req = new Request('http://localhost/api/studies/bulk-import', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=----ficticio',
        'content-length': String(2 * 1024 * 1024 * 1024),
      },
      body: '------ficticio--\r\n',
    })
    const formData = vi.spyOn(req, 'formData')

    const res = await POST(req)

    expect(res.status).toBe(413)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe('S5 — la importación masiva reutiliza la validación del PDF', () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:study_admin',
    })
  })

  it('no guarda un archivo application/pdf sin firma %PDF-', async () => {
    const file = new File([new TextEncoder().encode('esto no es un pdf')], 'protocolo-ficticio.pdf', {
      type: 'application/pdf',
    })

    const res = await POST(requestWithFile(file))
    const body = (await res.json()) as { items: Array<{ status: string; error: string | null }> }

    expect(res.status).toBe(202)
    expect(body.items[0]?.status).toBe('error')
    expect(body.items[0]?.error).toMatch(/PDF/)
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('no acepta un .pdf cuyo MIME no es application/pdf', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 protocolo ficticio')
    const file = new File([bytes], 'notas.pdf', { type: 'text/plain' })

    const res = await POST(requestWithFile(file))
    const body = (await res.json()) as { items: Array<{ status: string }> }

    expect(body.items[0]?.status).toBe('error')
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
  })
})

const PROVIDER_SENTINEL = 'sk-ant-provider-raw-ficticio-NO-LOG'

function flattenLogValue(value: unknown): string {
  if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ''}`
  if (Array.isArray(value)) return value.map(flattenLogValue).join(' ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => args.map(flattenLogValue).join(' ')).join('\n')
}

function validPdfRequest(): Request {
  const bytes = new TextEncoder().encode('%PDF-1.4 protocolo ficticio')
  const file = new File([bytes], 'protocolo-ficticio.pdf', { type: 'application/pdf' })
  return requestWithFile(file)
}

describe('POST /api/studies/bulk-import — S8 mensaje crudo', () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({
      userId: 'user_ficticio',
      orgId: 'org_clerk_ficticia',
      orgRole: 'org:study_admin',
    })
  })

  it('un ítem que no se registra no deja el error crudo en el log', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const res = await POST(validPdfRequest())
      const body = (await res.json()) as { items: Array<{ status: string; error: string | null }> }
      const logged = loggedText(spy)

      expect(res.status).toBe(202)
      expect(body.items[0]?.status).toBe('error')
      expect(body.items[0]?.error).not.toContain(PROVIDER_SENTINEL)
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('bulk_item_failed')
    } finally {
      spy.mockRestore()
    }
  })

  it('el fallo del job en background no deja el error crudo en el log', async () => {
    const jobs: Array<Promise<unknown>> = []
    mocks.after.mockImplementation((fn: () => Promise<void>) => {
      jobs.push(Promise.resolve().then(fn))
    })
    mocks.runSingleIngestionJobById.mockRejectedValue(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const res = await POST(validPdfRequest())
      await Promise.all(jobs)
      const logged = loggedText(spy)

      expect(res.status).toBe(202)
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('bulk_job_failed')
    } finally {
      spy.mockRestore()
      mocks.after.mockReset()
    }
  })
})
