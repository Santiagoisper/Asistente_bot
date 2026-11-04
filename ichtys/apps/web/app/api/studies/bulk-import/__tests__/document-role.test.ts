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
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))

vi.mock('@ichtys/auth', async () => {
  const roles = await vi.importActual<typeof import('@ichtys/auth/roles')>('@ichtys/auth/roles')
  return {
    canManageDocuments: roles.canManageDocuments,
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
  runSingleIngestionJobById: vi.fn(),
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
})
