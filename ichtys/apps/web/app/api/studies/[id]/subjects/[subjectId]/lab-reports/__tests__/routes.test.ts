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
    createLabReportFromPdf: vi.fn(),
    loadLabReport: vi.fn(),
    confirmLabReport: vi.fn(),
    rejectLabReport: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: (err: unknown) =>
    err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('error', { status: 500 }),
}))
vi.mock('../../../../../../../../lib/chat/persistence', () => ({ writeAuditLog: mocks.writeAuditLog }))
vi.mock('../../../../../../../../lib/labs/lab-report-service', () => ({
  LabReportError: mocks.LabReportError,
  createLabReportFromPdf: mocks.createLabReportFromPdf,
  loadLabReport: mocks.loadLabReport,
  confirmLabReport: mocks.confirmLabReport,
  rejectLabReport: mocks.rejectLabReport,
}))
vi.mock('../../../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))
vi.mock('../../../../../../../../lib/os/org-settings', () => ({ loadOrgTimeZone: async (orgId: string) => (orgId === 'org-bogota' ? 'America/Bogota' : 'America/Argentina/Buenos_Aires') }))

import { POST as upload } from '../route'
import { GET as read } from '../[reportId]/route'
import { POST as confirm } from '../[reportId]/confirm/route'
import { POST as reject } from '../[reportId]/reject/route'
import { GET as exportCsv } from '../[reportId]/export/route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const REPORT = '33333333-3333-4333-8333-333333333333'
const ctx = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT }) }
const reportCtx = { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, reportId: REPORT }) }
const row = { analyte: 'Hemoglobina', printedValue: '13,5', value: 13.5, unit: 'g/dL', referenceRange: '12,0 - 16,0', sourceLine: 1 }
const savedEnv = { vercel: process.env.VERCEL_ENV, os: process.env.ALPHI_OS }

function uploadRequest(file: File): Request {
  const form = new FormData()
  form.set('file', file)
  const req = new Request('https://os.example.test/upload', { method: 'POST', body: form })
  const headers = new Headers(req.headers)
  headers.set('content-length', String(file.size + 400))
  return new Request(req, { headers })
}
const pdf = (body = '%PDF-1.7 contenido') => new File([body], 'PEREZ_JUAN_hemograma.pdf', { type: 'application/pdf' })
const jsonRequest = (body: unknown) =>
  new Request('https://os.example.test/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VERCEL_ENV = 'preview'
  mocks.validateSubjectAccess.mockResolvedValue({ userId: 'user_1', orgId: 'org-1', role: 'site_coordinator', subject: { subjectCode: 'SUJ-1047' }, study: { name: 'Estudio de demostración', protocolNumber: 'ABC-301' } })
  mocks.createLabReportFromPdf.mockResolvedValue({ reportId: REPORT, rowCount: 6, reviewCount: 1, newFieldCount: 1 })
  mocks.confirmLabReport.mockResolvedValue({ rowCount: 1, newAnalytes: 0, profileUpdated: true })
  mocks.rejectLabReport.mockResolvedValue(undefined)
})

afterEach(() => {
  if (savedEnv.vercel === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = savedEnv.vercel
  if (savedEnv.os === undefined) delete process.env.ALPHI_OS
  else process.env.ALPHI_OS = savedEnv.os
})

describe('POST lab-reports — subir PDF', () => {
  it('sin acceso al sujeto no se lee el archivo', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    const res = await upload(uploadRequest(pdf()), ctx)
    expect(res.status).toBe(403)
    expect(mocks.createLabReportFromPdf).not.toHaveBeenCalled()
  })

  it('valida el sujeto contra el estudio de la URL', async () => {
    await upload(uploadRequest(pdf()), ctx)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY, { require: 'labs.manage' })
  })

  it('un archivo que no es PDF: 415', async () => {
    const res = await upload(uploadRequest(new File(['hola'], 'foto.png', { type: 'image/png' })), ctx)
    expect(res.status).toBe(415)
    const disguised = await upload(uploadRequest(new File(['no soy pdf'], 'x.pdf', { type: 'application/pdf' })), ctx)
    expect(disguised.status).toBe(415)
    expect(mocks.createLabReportFromPdf).not.toHaveBeenCalled()
  })

  it('cuerpo declarado por encima del tope: 413 sin leerlo', async () => {
    const req = uploadRequest(pdf())
    const headers = new Headers(req.headers)
    headers.set('content-length', String(11 * 1024 * 1024))
    expect((await upload(new Request(req, { headers }), ctx)).status).toBe(413)
    expect(mocks.createLabReportFromPdf).not.toHaveBeenCalled()
  })

  it('sin tamaño declarado igual se procesa: el navegador no siempre lo manda', async () => {
    const req = uploadRequest(pdf())
    const headers = new Headers(req.headers)
    headers.delete('content-length')
    const res = await upload(new Request(req, { headers }), ctx)
    expect(res.status).toBe(201)
    expect(mocks.createLabReportFromPdf).toHaveBeenCalledTimes(1)
  })

  it('sin tamaño declarado, un archivo por encima del tope se rechaza igual: 413', async () => {
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' })
    const req = uploadRequest(big)
    const headers = new Headers(req.headers)
    headers.delete('content-length')
    expect((await upload(new Request(req, { headers }), ctx)).status).toBe(413)
    expect(mocks.createLabReportFromPdf).not.toHaveBeenCalled()
  })

  it('el registro de un rechazo lleva el código y el tamaño, nunca el nombre del archivo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.createLabReportFromPdf.mockRejectedValue(new mocks.LabReportError('no_rows'))
    await upload(uploadRequest(pdf()), ctx)
    const logged = JSON.stringify(warn.mock.calls)
    warn.mockRestore()
    expect(logged).toContain('no_rows')
    expect(logged).not.toMatch(/\.pdf/)
  })

  it('PDF escaneado sin texto: 422 con código estable', async () => {
    mocks.createLabReportFromPdf.mockRejectedValue(new mocks.LabReportError('no_text'))
    const res = await upload(uploadRequest(pdf()), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'no_text' })
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('éxito: 201, con la organización del token y auditoría sin valores ni nombre de archivo', async () => {
    const res = await upload(uploadRequest(pdf()), ctx)
    expect(res.status).toBe(201)
    expect(mocks.createLabReportFromPdf).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, userId: 'user_1' }))
    const audit = JSON.stringify(mocks.writeAuditLog.mock.calls[0]?.[0])
    expect(audit).toContain('lab.extract')
    expect(audit).not.toContain('PEREZ')
    expect(audit).not.toContain('13,5')
  })

  it('con el interruptor apagado en producción: 404 antes de autenticar', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_OS
    expect((await upload(uploadRequest(pdf()), ctx)).status).toBe(404)
    expect(mocks.validateSubjectAccess).not.toHaveBeenCalled()
  })
})

describe('GET lab-reports/[reportId]', () => {
  it('un id que no es UUID no llega a la base', async () => {
    const res = await read(new Request('https://os.example.test/x'), { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, reportId: "1' OR '1'='1" }) })
    expect(res.status).toBe(404)
    expect(mocks.loadLabReport).not.toHaveBeenCalled()
  })

  it('informe de otro sujeto u organización: 404', async () => {
    mocks.loadLabReport.mockRejectedValue(new mocks.LabReportError('not_found'))
    expect((await read(new Request('https://os.example.test/x'), reportCtx)).status).toBe(404)
  })

  it('devuelve el informe, registra el acceso y no permite caché', async () => {
    mocks.loadLabReport.mockResolvedValue({ id: REPORT, status: 'pending_review', createdAt: new Date('2026-11-10T12:00:00Z'), reviewedAt: null, content: { rows: [] } })
    const res = await read(new Request('https://os.example.test/x'), reportCtx)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mocks.loadLabReport).toHaveBeenCalledWith({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, reportId: REPORT })
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'subject.view', resourceId: REPORT }))
  })
})

describe('POST confirm / reject', () => {
  it('cuerpo inválido: 400 y no se confirma nada', async () => {
    expect((await confirm(jsonRequest({ rows: [] }), reportCtx)).status).toBe(400)
    expect((await confirm(jsonRequest({ rows: [{ ...row, value: 'trece' }] }), reportCtx)).status).toBe(400)
    expect(mocks.confirmLabReport).not.toHaveBeenCalled()
  })

  it('segunda confirmación (doble clic): 409', async () => {
    mocks.confirmLabReport.mockRejectedValue(new mocks.LabReportError('already_reviewed'))
    const res = await confirm(jsonRequest({ rows: [row] }), reportCtx)
    expect(res.status).toBe(409)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('confirmación: auditoría con conteos, sin valores', async () => {
    const res = await confirm(jsonRequest({ rows: [row] }), reportCtx)
    expect(res.status).toBe(200)
    const audit = JSON.stringify(mocks.writeAuditLog.mock.calls[0]?.[0])
    expect(audit).toContain('lab.confirm')
    expect(audit).not.toContain('13,5')
    expect(audit).not.toContain('Hemoglobina')
  })

  it('rechazo: registra lab.reject; ya revisado da 409', async () => {
    expect((await reject(new Request('https://os.example.test/x', { method: 'POST' }), reportCtx)).status).toBe(200)
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'lab.reject' }))
    mocks.rejectLabReport.mockRejectedValue(new mocks.LabReportError('already_reviewed'))
    expect((await reject(new Request('https://os.example.test/x', { method: 'POST' }), reportCtx)).status).toBe(409)
  })

  it('sin acceso: no se confirma ni se rechaza', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Unauthorized', 401))
    expect((await confirm(jsonRequest({ rows: [row] }), reportCtx)).status).toBe(401)
    expect((await reject(new Request('https://os.example.test/x', { method: 'POST' }), reportCtx)).status).toBe(401)
    expect(mocks.confirmLabReport).not.toHaveBeenCalled()
    expect(mocks.rejectLabReport).not.toHaveBeenCalled()
  })
})

describe('GET lab-reports/[reportId]/export — sin sistema de destino', () => {
  const get = () => new Request('https://os.example.test/export')
  const confirmed = {
    id: REPORT,
    status: 'confirmed',
    createdAt: new Date('2026-11-10T12:00:00Z'),
    reviewedAt: new Date('2026-11-11T15:30:00Z'),
    content: { rows: [{ ...row, id: 'r1', status: 'read', isNewField: false, reviewReason: null }] },
  }

  it('sin acceso al sujeto no se lee el informe', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    expect((await exportCsv(get(), reportCtx)).status).toBe(403)
    expect(mocks.loadLabReport).not.toHaveBeenCalled()
  })

  it('un id que no es UUID no llega a la base', async () => {
    const res = await exportCsv(get(), { params: Promise.resolve({ id: STUDY, subjectId: SUBJECT, reportId: '../../x' }) })
    expect(res.status).toBe(404)
    expect(mocks.loadLabReport).not.toHaveBeenCalled()
  })

  it('informe de otro sujeto u organización: 404', async () => {
    mocks.loadLabReport.mockRejectedValue(new mocks.LabReportError('not_found'))
    expect((await exportCsv(get(), reportCtx)).status).toBe(404)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it.each(['pending_review', 'rejected'])('un informe %s no se exporta: 409 y no queda registro de exportación', async (status) => {
    mocks.loadLabReport.mockResolvedValue({ ...confirmed, status, reviewedAt: null })
    const res = await exportCsv(get(), reportCtx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_reviewed' })
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('informe revisado: descarga el CSV con el código del sujeto, sin caché', async () => {
    mocks.loadLabReport.mockResolvedValue(confirmed)
    const res = await exportCsv(get(), reportCtx)
    expect(res.status).toBe(200)
    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(SUBJECT, STUDY)
    expect(mocks.loadLabReport).toHaveBeenCalledWith({ orgId: 'org-1', studyId: STUDY, subjectId: SUBJECT, reportId: REPORT })
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="laboratorio-ABC-301-SUJ-1047-2026-11-11-33333333.csv"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const body = new TextDecoder().decode(bytes)
    expect(body).toContain('ABC-301;SUJ-1047;Hemoglobina;13,5;13,5;g/dL;12,0 - 16,0;2026-11-11 12:30;33333333')
  })

  it('queda registrado quién exportó y cuántas filas, sin ningún valor', async () => {
    mocks.loadLabReport.mockResolvedValue(confirmed)
    await exportCsv(get(), reportCtx)
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      action: 'lab.export',
      orgId: 'org-1',
      studyId: STUDY,
      userId: 'user_1',
      resourceType: 'lab_report',
      resourceId: REPORT,
      metadata: { subjectId: SUBJECT, rowCount: 1, format: 'csv', destination: 'none' },
    })
    const audit = JSON.stringify(mocks.writeAuditLog.mock.calls[0]?.[0])
    expect(audit).not.toContain('13,5')
    expect(audit).not.toContain('Hemoglobina')
  })

  it('copiar también pasa por el servidor: devuelve el texto para pegar y queda registrado', async () => {
    mocks.loadLabReport.mockResolvedValue(confirmed)
    const res = await exportCsv(new Request('https://os.example.test/export?formato=texto'), reportCtx)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.text()).toBe('Hemoglobina\t13,5\tg/dL')
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'lab.export', metadata: { subjectId: SUBJECT, rowCount: 1, format: 'clipboard', destination: 'none' } }))
  })

  it('un formato que no existe: 400, sin leer el informe ni registrar nada', async () => {
    const res = await exportCsv(new Request('https://os.example.test/export?formato=xlsx'), reportCtx)
    expect(res.status).toBe(400)
    expect(mocks.loadLabReport).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('un estudio sin número de protocolo usa su nombre', async () => {
    mocks.validateSubjectAccess.mockResolvedValue({ userId: 'user_1', orgId: 'org-1', subject: { subjectCode: 'SUJ-1047' }, study: { name: 'Estudio de demostración', protocolNumber: '  ' } })
    mocks.loadLabReport.mockResolvedValue(confirmed)
    const res = await exportCsv(get(), reportCtx)
    expect(await res.text()).toContain('Estudio de demostración;SUJ-1047;')
  })

  it('la hora de revisión del CSV sale en la zona del centro, no en la de la instalación', async () => {
    mocks.validateSubjectAccess.mockResolvedValue({ userId: 'user_2', orgId: 'org-bogota', subject: { subjectCode: 'SUJ-1047' }, study: { name: 'Estudio de demostración', protocolNumber: 'ABC-301' } })
    mocks.loadLabReport.mockResolvedValue(confirmed)
    const res = await exportCsv(get(), reportCtx)
    // 15:30 UTC son las 10:30 en Bogotá (y las 12:30 en Buenos Aires).
    expect(await res.text()).toContain(';2026-11-11 10:30;33333333')
  })

  it('si no se puede dejar registro, no se entrega el archivo', async () => {
    mocks.loadLabReport.mockResolvedValue(confirmed)
    mocks.writeAuditLog.mockRejectedValue(new Error('db down'))
    const res = await exportCsv(get(), reportCtx)
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('Hemoglobina')
  })

  it('con el interruptor apagado en producción: 404 antes de autenticar', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_OS
    expect((await exportCsv(get(), reportCtx)).status).toBe(404)
    expect(mocks.validateSubjectAccess).not.toHaveBeenCalled()
  })
})
