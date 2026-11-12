import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveOrProvisionOrganization: vi.fn(),
  putPrivateDocumentPdf: vi.fn(),
  enforceSlidingWindowRateLimit: vi.fn(),
  getUploadRateLimitConfig: vi.fn().mockReturnValue({ limit: 10, windowSeconds: 60 }),
  getBulkRateLimitConfig: vi.fn().mockReturnValue({ limit: 10, orgLimit: 40, windowSeconds: 60 }),
  rateLimitResponse: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  txValues: vi.fn(),
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
  getBulkRateLimitConfig: mocks.getBulkRateLimitConfig,
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
  studies: { __table: 'studies' },
  documents: { __table: 'documents' },
  documentVersions: { __table: 'document_versions' },
  ingestionJobs: { __table: 'ingestion_jobs', id: 'ingestionJobs.id' },
  auditLogs: { __table: 'audit_logs' },
  studyMemberships: { __table: 'study_memberships' },
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
  mocks.getBulkRateLimitConfig.mockReturnValue({ limit: 10, orgLimit: 40, windowSeconds: 60 })
  mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: false })
  mocks.resolveOrProvisionOrganization.mockResolvedValue({ id: 'org-interna', accessMode: 'open' })
  mocks.putPrivateDocumentPdf.mockResolvedValue({
    url: 'https://blob.example/protocolo-ficticio.pdf',
    pathname: 'clinical-documents/protocolo-ficticio.pdf',
  })
  mocks.insert.mockReturnValue({
    values: () => ({ returning: async () => [{ id: 'job-err' }] }),
  })
  mocks.transaction.mockImplementation(async (cb: (tx: { insert: () => unknown }) => unknown) => {
    // Cada fila que la transacción escribe queda registrada con su tabla.
    const insert = (table?: { __table?: string }) => ({
      values: (row?: unknown) => {
        mocks.txValues(table?.__table, row)
        return { returning: async () => [{ id: 'row-1' }] }
      },
    })
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
    // El 202 solo no alcanza: un ítem que falla adentro también devuelve 202.
    const body = (await res.json()) as { items: Array<{ status: string }> }
    expect(body.items[0]?.status).not.toBe('error')
  })

  it('quien importa queda como miembro de cada estudio que abre, en la misma transacción (regla 3)', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk', orgRole: 'org:study_admin' })

    const res = await POST(bulkRequest())

    expect(res.status).toBe(202)
    const written = mocks.txValues.mock.calls as Array<[string | undefined, Record<string, unknown>]>
    const membership = written.filter(([table]) => table === 'study_memberships')
    expect(membership).toHaveLength(1)
    expect(membership[0]?.[1]).toEqual({
      organizationId: 'org-interna',
      studyId: 'row-1',
      userId: 'user_1',
      createdBy: 'user_1',
    })
    const grants = written.filter(
      ([table, row]) => table === 'audit_logs' && row.action === 'access.membership.grant',
    )
    expect(grants).toHaveLength(1)
    expect(grants[0]?.[1]).toMatchObject({ studyId: 'row-1', userId: 'user_1', resourceType: 'study_membership' })
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

  it('lee los 8000 bytes reales aunque el Content-Length diga 1', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:study_admin',
    })
    const fileBytes = new Uint8Array(8000).fill(0x41)
    const head = new TextEncoder().encode(
      '------ficticio\r\nContent-Disposition: form-data; name="files"; filename="protocolo-ficticio.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
    )
    const tail = new TextEncoder().encode('\r\n------ficticio--\r\n')
    const body = new Uint8Array(head.length + fileBytes.length + tail.length)
    body.set(head, 0)
    body.set(fileBytes, head.length)
    body.set(tail, head.length + fileBytes.length)
    const req = new Request('http://localhost/api/studies/bulk-import', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=----ficticio',
        'content-length': '1',
      },
      body,
    })

    const res = await POST(req)
    const payload = await res.json() as { items?: Array<{ fileName?: string }> }

    expect(res.status).toBe(202)
    expect(payload.items?.[0]?.fileName).toBe('protocolo-ficticio.pdf')
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
  })

  it('aborta un cuerpo real por encima de 100 MB aunque el Content-Length diga 1', async () => {
    mocks.auth.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_clerk',
      orgRole: 'org:study_admin',
    })
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 101 * 1024 * 1024) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
        sent += chunk.byteLength
      },
    })
    const req = new Request('http://localhost/api/studies/bulk-import', {
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
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.putPrivateDocumentPdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  }, 30_000)
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
