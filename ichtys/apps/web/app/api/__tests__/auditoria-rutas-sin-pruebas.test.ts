/**
 * Auditoría 19/11, H-02: rutas de la API que no tenían ninguna prueba.
 * Cada una: el acceso decide (sin sesión, otra organización, sin permiso), una
 * entrada mala no llega a la base, un error inesperado no se disfraza de 401, y
 * el caso feliz devuelve solo lo que corresponde.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class AccessError extends Error {
    constructor(message: string, public status: 401 | 403 | 404) {
      super(message)
    }
  }
  return {
    AccessError,
    auth: vi.fn(),
    validateStudyAccess: vi.fn(),
    validateSubjectAccess: vi.fn(),
    validateDocumentPageAccess: vi.fn(),
    loadAccessSubject: vi.fn(),
    allows: vi.fn(),
    listSubjectAudios: vi.fn(),
    annotate: vi.fn(),
    recover: vi.fn(),
    findOrg: vi.fn(),
    findJobs: vi.fn(),
    findDocs: vi.fn(),
    findVersions: vi.fn(),
    insertValues: vi.fn(),
    selectRows: vi.fn(),
    validateDocumentVersionAccess: vi.fn(),
    getPdf: vi.fn(),
    specSafeParse: vi.fn(),
    diffSpecs: vi.fn(),
  }
})

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@ichtys/auth', () => ({
  AccessError: h.AccessError,
  validateStudyAccess: h.validateStudyAccess,
  validateSubjectAccess: h.validateSubjectAccess,
  validateDocumentPageAccess: h.validateDocumentPageAccess,
  validateDocumentVersionAccess: h.validateDocumentVersionAccess,
  loadAccessSubject: h.loadAccessSubject,
  canAdministerStudy: vi.fn(() => true),
  normalizeRole: (role: string | null) => role ?? 'monitor',
  handleApiError: (err: unknown) =>
    err instanceof h.AccessError
      ? new Response(err.message, { status: err.status })
      : new Response('Internal Server Error', { status: 500 }),
}))
vi.mock('@ichtys/auth/functions', () => ({ allows: h.allows }))
vi.mock('@ichtys/db', () => {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    from: () => chain,
    // Perezoso: la consulta corre recién cuando la ruta la espera (con o sin orderBy).
    where: () => ({
      orderBy: () => h.selectRows(),
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(h.selectRows()).then(ok, ko),
    }),
  })
  return {
    db: {
      query: {
        organizations: { findFirst: h.findOrg },
        ingestionJobs: { findMany: h.findJobs },
        documents: { findMany: h.findDocs },
        documentVersions: { findMany: h.findVersions },
      },
      insert: () => ({ values: h.insertValues }),
      select: () => chain,
    },
    and: (...a: unknown[]) => ({ and: a }),
    eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
    desc: (a: unknown) => ({ desc: a }),
    inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
    auditLogs: {},
    ingestionJobs: { organizationId: 'organizationId', batchId: 'batchId' },
    organizations: { clerkOrgId: 'clerkOrgId' },
    studySpecs: { organizationId: 'o', studyId: 's', version: 'v' },
  }
})
vi.mock('../../../lib/dictation/audio-store', () => ({
  DICTATION_AUDIO_RETENTION_DAYS: 30,
  listSubjectAudios: h.listSubjectAudios,
}))
vi.mock('@ichtys/rag/medical-annotator', () => ({ annotateAnswerSync: h.annotate }))
vi.mock('@ichtys/ingestion', () => ({ checkAndRecoverStuckDocs: h.recover, studySpecSchema: { safeParse: h.specSafeParse } }))
vi.mock('../document-versions/[documentVersionId]/download/blob-download', () => ({ getPrivateDocumentPdf: h.getPdf }))
vi.mock('../../../lib/spec-diff', () => ({ diffSpecs: h.diffSpecs }))

import { GET as bulkStatus } from '../studies/bulk-import/[batchId]/route'
import { GET as studyDocuments } from '../studies/[id]/documents/route'
import { GET as warmup } from '../chat/warmup/route'
import { GET as subjectAudios } from '../studies/[id]/subjects/[subjectId]/dictation-audios/route'
import { GET as documentPage } from '../documents/[id]/page/[pageNumber]/route'
import { GET as annotate } from '../annotate/route'
import { GET as specsList } from '../studies/[id]/specs/route'
import { GET as recoverStuck } from '../cron/recover-stuck-docs/route'
import { GET as download } from '../document-versions/[documentVersionId]/download/route'
import { GET as specsDiff } from '../studies/[id]/specs/diff/route'

const BATCH = '11111111-1111-4111-8111-111111111111'
const DOC = '22222222-2222-4222-8222-222222222222'
const p = <T>(v: T) => ({ params: Promise.resolve(v) })

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ userId: 'user-1', orgId: 'org_clerk_1', orgRole: 'org:admin' })
  h.findOrg.mockResolvedValue({ id: 'org-1', accessMode: 'open' })
  h.loadAccessSubject.mockResolvedValue({ mode: 'open' })
  h.allows.mockReturnValue(true)
  h.insertValues.mockResolvedValue(undefined)
})

describe('GET /api/studies/bulk-import/[batchId]', () => {
  it('sin sesión: 401 sin consultar', async () => {
    h.auth.mockResolvedValue({ userId: null, orgId: null })
    expect((await bulkStatus(new Request('http://x'), p({ batchId: BATCH }))).status).toBe(401)
    expect(h.findJobs).not.toHaveBeenCalled()
  })

  it('identificador que no es UUID: 400 sin consultar (antes llegaba a la base)', async () => {
    expect((await bulkStatus(new Request('http://x'), p({ batchId: 'abc' }))).status).toBe(400)
    expect(h.findOrg).not.toHaveBeenCalled()
  })

  it('sin el permiso de crear estudios: 403 y no lista archivos', async () => {
    h.allows.mockReturnValue(false)
    expect((await bulkStatus(new Request('http://x'), p({ batchId: BATCH }))).status).toBe(403)
    expect(h.findJobs).not.toHaveBeenCalled()
    expect(h.allows.mock.calls[0]?.[1]).toBe('study.create')
  })

  it('lote de otra organización (o inexistente): 404', async () => {
    h.findJobs.mockResolvedValue([])
    expect((await bulkStatus(new Request('http://x'), p({ batchId: BATCH }))).status).toBe(404)
  })

  it('caso feliz: cuenta por estado', async () => {
    h.findJobs.mockResolvedValue([
      { id: 'j1', status: 'ready', fileName: 'a.pdf', attemptCount: 1, maxAttempts: 3 },
      { id: 'j2', status: 'pending', fileName: 'b.pdf', attemptCount: 0, maxAttempts: 3 },
      { id: 'j3', status: 'error', fileName: 'c.pdf', errorMessage: 'x', attemptCount: 3, maxAttempts: 3 },
    ])
    const body = await (await bulkStatus(new Request('http://x'), p({ batchId: BATCH }))).json()
    expect(body).toMatchObject({ total: 3, ready: 1, processing: 1, error: 1 })
  })
})

describe('GET /api/studies/[id]/documents', () => {
  it('sin acceso al estudio: el código del acceso (404), no 401 fijo', async () => {
    h.validateStudyAccess.mockRejectedValue(new h.AccessError('Study not found', 404))
    expect((await studyDocuments(new Request('http://x'), p({ id: 's-1' }))).status).toBe(404)
  })

  it('una caída de la base es 500, no 401 (antes se disfrazaba de no autorizado)', async () => {
    h.validateStudyAccess.mockResolvedValue({ study: { id: 's-1' }, orgId: 'org-1' })
    h.findDocs.mockRejectedValue(new Error('connection reset'))
    expect((await studyDocuments(new Request('http://x'), p({ id: 's-1' }))).status).toBe(500)
  })

  it('caso feliz: la última versión de cada documento', async () => {
    h.validateStudyAccess.mockResolvedValue({ study: { id: 's-1' }, orgId: 'org-1' })
    h.findDocs.mockResolvedValue([{ id: 'd1', name: 'P', documentType: 'protocol', createdAt: new Date('2026-11-01') }])
    h.findVersions.mockResolvedValue([
      { id: 'v2', documentId: 'd1', status: 'ready', pageCount: 10, errorMessage: null },
      { id: 'v1', documentId: 'd1', status: 'error', pageCount: null, errorMessage: 'x' },
    ])
    const body = await (await studyDocuments(new Request('http://x'), p({ id: 's-1' }))).json()
    expect(body).toEqual([expect.objectContaining({ documentId: 'd1', latestVersionId: 'v2', status: 'ready' })])
  })
})

describe('GET /api/chat/warmup', () => {
  it('sin studyId: 400', async () => {
    expect((await warmup(new Request('http://x/api/chat/warmup'))).status).toBe(400)
  })
  it('sin acceso: el código del acceso', async () => {
    h.validateStudyAccess.mockRejectedValue(new h.AccessError('Forbidden', 403))
    expect((await warmup(new Request('http://x/api/chat/warmup?studyId=s-1'))).status).toBe(403)
  })
  it('error inesperado: 500, no 401', async () => {
    h.validateStudyAccess.mockRejectedValue(new Error('db down'))
    expect((await warmup(new Request('http://x/api/chat/warmup?studyId=s-1'))).status).toBe(500)
  })
  it('con acceso: ok', async () => {
    h.validateStudyAccess.mockResolvedValue({})
    expect(await (await warmup(new Request('http://x/api/chat/warmup?studyId=s-1'))).json()).toEqual({ ok: true })
  })
})

describe('GET /api/studies/[id]/subjects/[subjectId]/dictation-audios', () => {
  it('sin acceso al sujeto: el código del acceso y no lista', async () => {
    h.validateSubjectAccess.mockRejectedValue(new h.AccessError('Not found', 404))
    expect((await subjectAudios(new Request('http://x'), p({ id: 's-1', subjectId: 'sub-1' }))).status).toBe(404)
    expect(h.listSubjectAudios).not.toHaveBeenCalled()
  })
  it('lista con la organización, el estudio y el sujeto del acceso, no los de la URL', async () => {
    h.validateSubjectAccess.mockResolvedValue({ orgId: 'org-1', study: { id: 's-real' }, subject: { id: 'sub-real' } })
    h.listSubjectAudios.mockResolvedValue([{ id: 'a1', expiresAt: new Date('2026-12-01T00:00:00Z') }])
    const body = await (await subjectAudios(new Request('http://x'), p({ id: 's-url', subjectId: 'sub-url' }))).json()
    expect(h.listSubjectAudios).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', studyId: 's-real', subjectId: 'sub-real' }))
    expect(body).toEqual({ retentionDays: 30, audios: [{ id: 'a1', expiresAt: '2026-12-01T00:00:00.000Z' }] })
  })
})

describe('GET /api/documents/[id]/page/[pageNumber]', () => {
  it.each([
    [{ id: 'abc', pageNumber: '1' }],
    [{ id: DOC, pageNumber: '0' }],
    [{ id: DOC, pageNumber: '-2' }],
    [{ id: DOC, pageNumber: 'x' }],
  ])('entrada mala %o: 400 sin validar acceso', async (params) => {
    expect((await documentPage(new Request('http://x'), p(params))).status).toBe(400)
    expect(h.validateDocumentPageAccess).not.toHaveBeenCalled()
  })

  it('sin acceso: el código del acceso y no audita una lectura', async () => {
    h.validateDocumentPageAccess.mockRejectedValue(new h.AccessError('Not found', 404))
    expect((await documentPage(new Request('http://x'), p({ id: DOC, pageNumber: '3' }))).status).toBe(404)
    expect(h.insertValues).not.toHaveBeenCalled()
  })

  it('con acceso: registra la vista en la auditoría y devuelve el enlace interno', async () => {
    h.validateDocumentPageAccess.mockResolvedValue({
      orgId: 'org-1', studyId: 's-1', userId: 'user-1',
      document: { id: DOC }, documentVersion: { id: 'v-1' }, page: { pageNumber: 3, rawText: 'texto' },
    })
    const body = await (await documentPage(new Request('http://x'), p({ id: DOC, pageNumber: '3' }))).json()
    expect(h.insertValues).toHaveBeenCalledWith(expect.objectContaining({ action: 'document.view', organizationId: 'org-1' }))
    expect(body.openUrl).toBe('/api/document-versions/v-1/download?inline=1#page=3')
  })
})

describe('GET /api/annotate', () => {
  it('sin sesión: 401 sin anotar', async () => {
    h.auth.mockResolvedValue({ userId: null })
    expect((await annotate(new Request('http://x/api/annotate?text=hola'))).status).toBe(401)
    expect(h.annotate).not.toHaveBeenCalled()
  })
  it.each([[''], ['?text='], [`?text=${'a'.repeat(5001)}`]])('texto vacío o de más de 5000: 400 (%#)', async (q) => {
    expect((await annotate(new Request(`http://x/api/annotate${q}`))).status).toBe(400)
  })
  it('caso feliz', async () => {
    h.annotate.mockReturnValue([{ code: 'x' }])
    expect(await (await annotate(new Request('http://x/api/annotate?text=diabetes'))).json()).toEqual({ annotations: [{ code: 'x' }] })
  })
})

describe('GET /api/studies/[id]/specs', () => {
  it('sin acceso: el código del acceso', async () => {
    h.validateStudyAccess.mockRejectedValue(new h.AccessError('Not found', 404))
    expect((await specsList(new Request('http://x'), p({ id: 's-1' }))).status).toBe(404)
  })
  it('error inesperado: 500', async () => {
    h.validateStudyAccess.mockResolvedValue({ orgId: 'org-1' })
    h.selectRows.mockRejectedValue(new Error('db'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await specsList(new Request('http://x'), p({ id: 's-1' }))).status).toBe(500)
    spy.mockRestore()
  })
  it('caso feliz: lista de versiones', async () => {
    h.validateStudyAccess.mockResolvedValue({ orgId: 'org-1' })
    h.selectRows.mockResolvedValue([{ id: 'sp1', version: 2 }])
    expect(await (await specsList(new Request('http://x'), p({ id: 's-1' }))).json()).toEqual({ specs: [{ id: 'sp1', version: 2 }] })
  })
})

describe('GET /api/cron/recover-stuck-docs', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secreto-de-prueba-largo'
  })
  it.each([[undefined], ['Bearer otro'], ['secreto-de-prueba-largo']])('sin el secreto exacto (%s): 401 sin recuperar', async (header) => {
    const headers = header ? { authorization: header } : undefined
    expect((await recoverStuck(new Request('http://x', { headers }))).status).toBe(401)
    expect(h.recover).not.toHaveBeenCalled()
  })
  it('con el secreto: recupera', async () => {
    h.recover.mockResolvedValue({ recovered: 0 })
    const res = await recoverStuck(new Request('http://x', { headers: { authorization: 'Bearer secreto-de-prueba-largo' } }))
    expect(res.status).toBe(200)
    expect(h.recover).toHaveBeenCalled()
  })
  it('si la recuperación falla: 500 sin el detalle del error', async () => {
    h.recover.mockRejectedValue(new Error('detalle interno'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await recoverStuck(new Request('http://x', { headers: { authorization: 'Bearer secreto-de-prueba-largo' } }))
    spy.mockRestore()
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('detalle interno')
  })
})

describe('GET /api/document-versions/[id]/download', () => {
  const VER = '33333333-3333-4333-8333-333333333333'
  const okAccess = {
    userId: 'user-1', orgId: 'org-1', studyId: 's-1',
    document: { id: DOC, name: 'Protocolo v2 (final).pdf' },
    documentVersion: { id: VER, blobUrl: 'https://blob/privado' },
  }

  it.each([
    ['UUID inválido', 'http://x', { documentVersionId: 'abc' }, undefined],
    ['organización en la URL', 'http://x?organization_id=otra', { documentVersionId: VER }, undefined],
    ['organización en la URL (camel)', 'http://x?organizationId=otra', { documentVersionId: VER }, undefined],
    ['cuerpo en un GET', 'http://x', { documentVersionId: VER }, { 'content-type': 'application/json' }],
  ])('%s: 400 sin validar acceso ni leer el blob', async (_n, url, params, headers) => {
    const res = await download(new Request(url, { headers }), p(params))
    expect(res.status).toBe(400)
    expect(h.validateDocumentVersionAccess).not.toHaveBeenCalled()
    expect(h.getPdf).not.toHaveBeenCalled()
  })

  it('sin acceso: el código del acceso y el blob no se toca', async () => {
    h.validateDocumentVersionAccess.mockRejectedValue(new h.AccessError('Not found', 404))
    expect((await download(new Request('http://x'), p({ documentVersionId: VER }))).status).toBe(404)
    expect(h.getPdf).not.toHaveBeenCalled()
  })

  it('descarga: audita, nombre saneado, sin caché y sin la dirección del blob', async () => {
    h.validateDocumentVersionAccess.mockResolvedValue(okAccess)
    h.getPdf.mockResolvedValue({ stream: 'pdf-bytes', size: 9 })
    const res = await download(new Request('http://x'), p({ documentVersionId: VER }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Protocolo-v2-final-.pdf"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-length')).toBe('9')
    expect(h.insertValues).toHaveBeenCalledWith(expect.objectContaining({ action: 'document.download', organizationId: 'org-1', resourceId: VER }))
    expect(JSON.stringify([...res.headers])).not.toContain('blob/privado')
  })

  it('vista en línea: se audita como vista', async () => {
    h.validateDocumentVersionAccess.mockResolvedValue(okAccess)
    h.getPdf.mockResolvedValue({ stream: 'pdf-bytes', size: null })
    const res = await download(new Request('http://x?inline=1'), p({ documentVersionId: VER }))
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(h.insertValues).toHaveBeenCalledWith(expect.objectContaining({ action: 'document.view' }))
  })

  it('si la auditoría falla, no se entrega el archivo', async () => {
    h.validateDocumentVersionAccess.mockResolvedValue(okAccess)
    h.getPdf.mockResolvedValue({ stream: 'pdf-bytes', size: 9 })
    h.insertValues.mockRejectedValue(new Error('db'))
    expect((await download(new Request('http://x'), p({ documentVersionId: VER }))).status).toBe(500)
  })
})

describe('GET /api/studies/[id]/specs/diff', () => {
  const A = '44444444-4444-4444-8444-444444444444'
  const B = '55555555-5555-4555-8555-555555555555'
  const url = (q: string) => new Request(`http://x/api/studies/s-1/specs/diff${q}`)

  it.each([[''], ['?v1=abc&v2=' + B], ['?v1=' + A]])('parámetros malos (%s): 400 sin consultar', async (q) => {
    expect((await specsDiff(url(q), p({ id: 's-1' }))).status).toBe(400)
    expect(h.validateStudyAccess).not.toHaveBeenCalled()
  })
  it('la misma versión dos veces: 400', async () => {
    expect((await specsDiff(url(`?v1=${A}&v2=${A}`), p({ id: 's-1' }))).status).toBe(400)
  })
  it('sin acceso: el código del acceso', async () => {
    h.validateStudyAccess.mockRejectedValue(new h.AccessError('Not found', 404))
    expect((await specsDiff(url(`?v1=${A}&v2=${B}`), p({ id: 's-1' }))).status).toBe(404)
  })
  it('una versión que no es de este estudio u organización: 404', async () => {
    h.validateStudyAccess.mockResolvedValue({ orgId: 'org-1' })
    h.selectRows.mockResolvedValue([{ id: A, spec: {}, version: 1 }])
    expect((await specsDiff(url(`?v1=${A}&v2=${B}`), p({ id: 's-1' }))).status).toBe(404)
  })
  it('un spec con formato viejo: 422', async () => {
    h.validateStudyAccess.mockResolvedValue({ orgId: 'org-1' })
    h.selectRows.mockResolvedValue([{ id: A, spec: {}, version: 1 }, { id: B, spec: {}, version: 2 }])
    h.specSafeParse.mockReturnValueOnce({ success: true, data: {} }).mockReturnValueOnce({ success: false })
    expect((await specsDiff(url(`?v1=${A}&v2=${B}`), p({ id: 's-1' }))).status).toBe(422)
  })
  it('caso feliz: compara en el orden pedido', async () => {
    h.validateStudyAccess.mockResolvedValue({ orgId: 'org-1' })
    h.selectRows.mockResolvedValue([{ id: B, spec: { b: 1 }, version: 2 }, { id: A, spec: { a: 1 }, version: 1 }])
    h.specSafeParse.mockImplementation((v: unknown) => ({ success: true, data: v }))
    h.diffSpecs.mockReturnValue({ changes: [] })
    const body = await (await specsDiff(url(`?v1=${A}&v2=${B}`), p({ id: 's-1' }))).json()
    expect(h.diffSpecs).toHaveBeenCalledWith({ a: 1 }, { b: 1 })
    expect(body).toEqual({ v1: { id: A, version: 1 }, v2: { id: B, version: 2 }, diff: { changes: [] } })
  })
})
