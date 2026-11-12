import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  class MockLabReportError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return {
    AccessError: MockAccessError,
    LabReportError: MockLabReportError,
    validateSubjectAccess: vi.fn(),
    writeAuditLog: vi.fn(),
    createLabReportFromImages: vi.fn(),
    loadLabReportImage: vi.fn(),
    confirmLabReport: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('error', { status: 500 }),
}))
vi.mock('../../../../../../../../lib/chat/persistence', () => ({ writeAuditLog: mocks.writeAuditLog }))
vi.mock('../../../../../../../../lib/labs/lab-report-service', () => ({ LabReportError: mocks.LabReportError, confirmLabReport: mocks.confirmLabReport }))
vi.mock('../../../../../../../../lib/labs/lab-image-report', () => ({
  createLabReportFromImages: mocks.createLabReportFromImages,
  loadLabReportImage: mocks.loadLabReportImage,
  validateLabImages: (files: Array<{ data: Uint8Array }>) => {
    if (files.some((file) => file.data[0] !== 0xff)) throw new mocks.LabReportError('bad_image')
    return files.map((file) => ({ mime: 'image/jpeg', data: file.data }))
  },
}))
vi.mock('../../../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))

import { POST as uploadImages } from '../images/route'
import { GET as readImage } from '../[reportId]/image/[page]/route'
import { POST as confirm } from '../[reportId]/confirm/route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const REPORT = '33333333-3333-4333-8333-333333333333'
const ctx = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT }) }
const imageCtx = (page: string, reportId = REPORT) => ({ params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, reportId, page }) })
const savedEnv = { vercel: process.env.VERCEL_ENV, os: process.env.ALPHI_OS }
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const jpeg = (name = 'PEREZ_JUAN_hoja1.jpg') => new File([JPEG], name, { type: 'image/jpeg' })

function imagesRequest(files: File[]): Request {
  const form = new FormData()
  for (const file of files) form.append('image', file)
  return new Request('https://os.example.test/images', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VERCEL_ENV = 'preview'
  mocks.validateSubjectAccess.mockResolvedValue({ userId: 'user_1', orgId: 'org-1', role: 'site_coordinator', subject: { subjectCode: 'SUJ-1047' } })
  mocks.createLabReportFromImages.mockResolvedValue({ reportId: REPORT, rowCount: 12, reviewCount: 2, newFieldCount: 3 })
  mocks.loadLabReportImage.mockResolvedValue({ mime: 'image/jpeg', data: JPEG })
  mocks.confirmLabReport.mockResolvedValue({ rowCount: 1, newAnalytes: 0, profileUpdated: true })
})

afterEach(() => {
  if (savedEnv.vercel === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = savedEnv.vercel
  if (savedEnv.os === undefined) delete process.env.ALPHI_OS
  else process.env.ALPHI_OS = savedEnv.os
})

describe('POST lab-reports/images — subir foto o escaneo', () => {
  it('con el OS apagado en producción no existe', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_OS
    expect((await uploadImages(imagesRequest([jpeg()]), ctx)).status).toBe(404)
    expect(mocks.validateSubjectAccess).not.toHaveBeenCalled()
  })

  it('sin acceso al sujeto no se lee ninguna imagen', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    expect((await uploadImages(imagesRequest([jpeg()]), ctx)).status).toBe(403)
    expect(mocks.createLabReportFromImages).not.toHaveBeenCalled()
  })

  it('éxito: 201, con la organización del token y auditoría sin nombre de archivo ni valores', async () => {
    const res = await uploadImages(imagesRequest([jpeg(), jpeg('hoja2.jpg')]), ctx)
    expect(res.status).toBe(201)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY, { require: 'labs.manage' })
    const call = mocks.createLabReportFromImages.mock.calls[0]![0] as { orgId: string; images: unknown[] }
    expect(call).toMatchObject({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, userId: 'user_1' })
    expect(call.images).toHaveLength(2)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
    const build = (call as unknown as { audit: (created: unknown) => unknown }).audit
    const audit = JSON.stringify(build({ reportId: REPORT, rowCount: 12, reviewCount: 2, newFieldCount: 3 }))
    expect(audit).toContain('"source":"image"')
    expect(audit).toContain('"pages":2')
    expect(audit).not.toContain('PEREZ')
  })

  it('sin imágenes: 400; más de seis: 413; una que no es imagen: 415', async () => {
    expect((await uploadImages(imagesRequest([]), ctx)).status).toBe(400)
    expect((await uploadImages(imagesRequest(Array.from({ length: 7 }, () => jpeg())), ctx)).status).toBe(413)
    const res = await uploadImages(imagesRequest([new File(['<svg/>'], 'x.jpg', { type: 'image/jpeg' })]), ctx)
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({ error: 'bad_image' })
    expect(mocks.createLabReportFromImages).not.toHaveBeenCalled()
  })

  it('una hoja por encima del tope: 413 sin leerla', async () => {
    const big = new File([new Uint8Array(1_500_001)], 'grande.jpg', { type: 'image/jpeg' })
    expect((await uploadImages(imagesRequest([big]), ctx)).status).toBe(413)
    expect(mocks.createLabReportFromImages).not.toHaveBeenCalled()
  })

  it('si ningún lector responde: 503 con código estable, sin auditoría y sin el nombre del archivo en el registro', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.createLabReportFromImages.mockRejectedValue(new mocks.LabReportError('reader_unavailable'))
    const res = await uploadImages(imagesRequest([jpeg()]), ctx)
    const logged = JSON.stringify(warn.mock.calls)
    warn.mockRestore()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'reader_unavailable' })
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
    expect(logged).toContain('reader_unavailable')
    expect(logged).not.toContain('PEREZ')
  })
})

describe('GET lab-reports/[reportId]/image/[page] — ver la imagen al revisar', () => {
  it('devuelve la imagen sin caché y solo para el sujeto de la URL', async () => {
    const res = await readImage(new Request('https://os.example.test/image'), imageCtx('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...JPEG])
    expect(mocks.loadLabReportImage).toHaveBeenCalledWith({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, reportId: REPORT, page: 1 })
  })

  it('sin acceso: 403; página o informe inválidos: 404 sin tocar la base', async () => {
    for (const [page, report] of [['0', REPORT], ['7', REPORT], ['1.5', REPORT], ['x', REPORT], ['1', 'no-es-uuid']] as const) {
      expect((await readImage(new Request('https://os.example.test/image'), imageCtx(page, report))).status).toBe(404)
    }
    expect(mocks.loadLabReportImage).not.toHaveBeenCalled()
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    expect((await readImage(new Request('https://os.example.test/image'), imageCtx('1'))).status).toBe(403)
  })

  it('informe ya revisado o de otro sujeto: 404', async () => {
    mocks.loadLabReportImage.mockRejectedValue(new mocks.LabReportError('not_found'))
    expect((await readImage(new Request('https://os.example.test/image'), imageCtx('1'))).status).toBe(404)
  })
})

describe('POST confirm — informe leído de una imagen', () => {
  const row = { analyte: 'Hemoglobina', printedValue: '13,5', value: 13.5, unit: 'g/dL', referenceRange: null, sourceLine: 0 }
  const request = (body: unknown) => new Request('https://os.example.test/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const confirmCtx = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, reportId: REPORT }) }

  it('pasa al servicio la declaración de que se comparó con la imagen y la deja en la auditoría', async () => {
    expect((await confirm(request({ rows: [row], comparedWithImage: true }), confirmCtx)).status).toBe(200)
    expect(mocks.confirmLabReport).toHaveBeenCalledWith(expect.objectContaining({ comparedWithImage: true }))
    const build = mocks.confirmLabReport.mock.calls[0]?.[0].audit as (facts: { rowCount: number; newAnalytes: number }) => unknown
    expect(JSON.stringify(build({ rowCount: 1, newAnalytes: 0 }))).toContain('"comparedWithImage":true')
  })

  it('un campo que no es del contrato se rechaza', async () => {
    expect((await confirm(request({ rows: [row], comparedWithImage: 'si' }), confirmCtx)).status).toBe(400)
    expect((await confirm(request({ rows: [row], saltearRevision: true }), confirmCtx)).status).toBe(400)
    expect(mocks.confirmLabReport).not.toHaveBeenCalled()
  })
})
