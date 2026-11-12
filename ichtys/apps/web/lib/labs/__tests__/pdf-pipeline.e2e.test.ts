import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Recorrido completo del módulo con un PDF real: bytes → texto → renglones →
 * informe cifrado → revisión → confirmación → catálogo y perfil.
 * Solo la base está simulada (en memoria); el lector de PDF, el intérprete,
 * el cifrado y el servicio son los de producción.
 */
const store = vi.hoisted(() => ({
  reports: [] as Array<Record<string, unknown>>,
  analytes: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  failAudit: false,
  profile: { labs: [] as Array<{ name: string; value: number; unit?: string }> },
  persisted: [] as Array<{ labs: Array<{ name: string; value: number; unit?: string }> }>,
}))

vi.mock('@ichtys/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ichtys/db')>()
  const isReports = (table: unknown) => table === original.labReports
  const make = (via: 'db' | 'tx') => ({
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(values) ? values : [values]
        if (table === original.auditLogs) {
          if (store.failAudit) return Promise.reject(new Error('audit insert failed'))
          store.audits.push({ via, ...list[0] })
          return Promise.resolve()
        }
        if (isReports(table)) {
          const row = { id: '33333333-3333-4333-8333-333333333333', createdAt: new Date(), reviewedAt: null, ...list[0] }
          store.reports.push(row)
          return { returning: async () => [{ id: row.id }] }
        }
        return {
          onConflictDoNothing: async () => {
            for (const value of list) {
              if (!store.analytes.some((entry) => entry.normalizedKey === value.normalizedKey)) store.analytes.push(value)
            }
          },
        }
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = isReports(table) ? store.reports : store.analytes.map((entry) => ({ key: entry.normalizedKey }))
          return Object.assign(Promise.resolve(rows), { limit: async () => rows })
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const report = store.reports[0]
            if (!report || report.status !== 'pending_review') return []
            Object.assign(report, values)
            return [{ id: report.id }]
          },
        }),
      }),
    }),
  })
  const db = { ...make('db'), transaction: async <T,>(work: (tx: unknown) => Promise<T>) => work(make('tx')) }
  return { ...original, db }
})

vi.mock('../../subjects/patient-profile-service', () => ({
  updatePatientProfile: vi.fn(async (_scope: unknown, mutate: (current: typeof store.profile) => (typeof store.persisted)[number]) => {
    const next = await mutate(store.profile)
    store.persisted.push(next)
    return next
  }),
}))

import { decryptClinicalContent } from '../../subjects/phi-fields'
import { labReportContentSchema } from '../lab-report-content'
import { confirmLabReport, createLabReportFromPdf, LabReportError, loadLabReport } from '../lab-report-service'
import { toConfirmPayload, toReviewRow } from '../review-rows'

/** PDF mínimo de una página con texto real (Helvetica), una línea por renglón. */
function buildPdf(lines: string[]): Uint8Array {
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const body = ['BT', '/F1 10 Tf', '50 780 Td', '14 TL', ...lines.map((line) => `(${escape(line)}) Tj T*`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

const scope = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1' }
const uploadAudit = (report: { reportId: string; rowCount: number }) => ({ action: 'lab.extract' as const, orgId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'lab_report', resourceId: report.reportId, metadata: { rowCount: report.rowCount } })
const audit = (facts?: { rowCount: number; newAnalytes: number }) => ({
  action: facts ? ('lab.confirm' as const) : ('lab.reject' as const),
  orgId: 'org-1',
  studyId: 'study-1',
  userId: 'user_2',
  resourceType: 'lab_report',
  resourceId: 'report',
  metadata: { ...facts },
})
const REPORT_LINES = [
  'LABORATORIO CENTRAL',
  'Paciente: PEREZ, JUAN CARLOS',
  'DNI: 23456789',
  'Fecha de extraccion: 05/11/2026',
  'HEMOGRAMA',
  'Hemoglobina 13,5 g/dL (12,0 - 16,0)',
  'Leucocitos 7.300 /mm3 (4.000 - 10.000)',
  'Glucosa 92 mg/dl 70 - 110',
  'Proteinas en orina: Negativo',
]
const savedKey = process.env.PHI_ENCRYPTION_KEY

beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
  store.analytes.push({ organizationId: 'org-1', name: 'Glucosa', normalizedKey: 'glucosa' })
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})

describe('Carga de laboratorios — PDF digital de punta a punta', () => {
  let reportId = ''

  it('sube el PDF: propone los campos y guarda todo cifrado, sin datos personales', async () => {
    const created = await createLabReportFromPdf({ ...scope, audit: uploadAudit, userId: 'user_1', fileName: 'PEREZ_JUAN.pdf', data: buildPdf(REPORT_LINES) })
    reportId = created.reportId
    expect(created).toMatchObject({ rowCount: 4, reviewCount: 1, newFieldCount: 3 })

    const stored = store.reports[0]!
    expect(stored).toMatchObject({ organizationId: 'org-1', studyId: 'study-1', subjectId: 'subject-1', status: 'pending_review', sourceKind: 'pdf_text', rowCount: 4, createdBy: 'user_1' })
    const cipher = String(stored.contentEncrypted)
    for (const plain of ['Hemoglobina', '13,5', 'PEREZ', '23456789']) expect(cipher).not.toContain(plain)

    const content = labReportContentSchema.parse(JSON.parse(decryptClinicalContent(cipher)))
    expect(content.fileName).toBe('informe.pdf')
    for (const leaked of ['PEREZ', 'JUAN', '23456789']) expect(content.transcription).not.toContain(leaked)
    expect(content.transcription).toContain('Hemoglobina 13,5 g/dL (12,0 - 16,0)')
    expect(content.rows.map((row) => [row.analyte, row.printedValue, row.value, row.status, row.isNewField])).toEqual([
      ['Hemoglobina', '13,5', 13.5, 'read', true],
      ['Leucocitos', '7.300', 7300, 'review', true],
      ['Glucosa', '92', 92, 'read', false],
      ['Proteinas en orina', 'Negativo', null, 'read', true],
    ])
  })

  it('la persona revisa: no puede confirmar hasta decidir la lectura ambigua', async () => {
    const report = await loadLabReport({ ...scope, reportId })
    const rows = report.content.rows.map(toReviewRow)
    expect(toConfirmPayload(rows)).toBeNull()
  })

  it('un valor que no figura en el informe se rechaza y el informe sigue pendiente', async () => {
    const report = await loadLabReport({ ...scope, reportId })
    const tampered = report.content.rows.map(toReviewRow).map((row) => (row.analyte === 'Leucocitos' ? { ...row, reading: 7300 } : row))
    const payload = toConfirmPayload(tampered)!
    payload[0] = { ...payload[0]!, printedValue: '18,5', value: 18.5 }
    await expect(confirmLabReport({ ...scope, reportId, userId: 'user_2', rows: payload, audit })).rejects.toMatchObject({ code: 'invalid_rows' })
    expect(store.reports[0]?.status).toBe('pending_review')
    expect(store.persisted).toHaveLength(0)
  })

  it('confirma: estado, catálogo y perfil del sujeto quedan actualizados', async () => {
    const report = await loadLabReport({ ...scope, reportId })
    const decided = report.content.rows.map(toReviewRow).map((row) => (row.analyte === 'Leucocitos' ? { ...row, reading: 7300 } : row))
    const result = await confirmLabReport({ ...scope, reportId, userId: 'user_2', rows: toConfirmPayload(decided)!, audit })
    expect(result).toEqual({ rowCount: 4, newAnalytes: 3, profileUpdated: true })
    expect(store.audits.map((entry) => entry.action)).toEqual(['lab.extract', 'lab.confirm'])
    expect(store.audits[1]).toMatchObject({ via: 'tx', action: 'lab.confirm', metadata: { rowCount: 4, newAnalytes: 3 } })

    expect(store.reports[0]).toMatchObject({ status: 'confirmed', reviewedBy: 'user_2' })
    expect(store.analytes.map((entry) => entry.normalizedKey).sort()).toEqual(['glucosa', 'hemoglobina', 'leucocitos', 'proteinas en orina'])
    expect(store.analytes.filter((entry) => entry.normalizedKey !== 'glucosa').every((entry) => entry.organizationId === 'org-1')).toBe(true)
    // Al perfil van solo los valores con número; el cualitativo queda en el informe.
    expect(store.persisted[0]?.labs).toEqual([
      { name: 'Hemoglobina', value: 13.5, unit: 'g/dL' },
      { name: 'Leucocitos', value: 7300, unit: '/mm3' },
      { name: 'Glucosa', value: 92, unit: 'mg/dl' },
    ])
    const confirmed = await loadLabReport({ ...scope, reportId })
    expect(confirmed.content.rows.every((row) => row.status === 'read' && row.reviewReason === null)).toBe(true)
  })

  it('segunda confirmación (doble clic): se rechaza y no duplica nada', async () => {
    const report = await loadLabReport({ ...scope, reportId })
    const payload = toConfirmPayload(report.content.rows.map(toReviewRow))!
    await expect(confirmLabReport({ ...scope, reportId, userId: 'user_3', rows: payload, audit })).rejects.toBeInstanceOf(LabReportError)
    // La segunda no reclamó el informe: tampoco deja un segundo registro de confirmación.
    expect(store.audits.map((entry) => entry.action)).toEqual(['lab.extract', 'lab.confirm'])
    expect(store.analytes).toHaveLength(4)
    expect(store.persisted).toHaveLength(1)
    expect(store.reports[0]?.reviewedBy).toBe('user_2')
  })

  it('un PDF sin resultados no crea ningún informe', async () => {
    const before = store.reports.length
    await expect(
      createLabReportFromPdf({ ...scope, audit: uploadAudit, userId: 'user_1', fileName: 'x.pdf', data: buildPdf(['Paciente: GOMEZ ANA', 'Sin resultados']) }),
    ).rejects.toMatchObject({ code: 'no_rows' })
    expect(store.reports).toHaveLength(before)
  })

  it('bytes que no son un PDF legible: error con código estable', async () => {
    await expect(
      createLabReportFromPdf({ ...scope, audit: uploadAudit, userId: 'user_1', fileName: 'x.pdf', data: new TextEncoder().encode('%PDF-1.4 basura') }),
    ).rejects.toBeInstanceOf(LabReportError)
  })
})

/** PDF de una página con cada texto en su posición: así llegan las tablas de los laboratorios. */
function buildColumnPdf(cells: Array<[x: number, y: number, text: string]>): Uint8Array {
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const body = ['BT', '/F1 10 Tf', ...cells.map(([x, y, text]) => `1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

describe('Carga de laboratorios — informe en columnas, como lo imprimen los laboratorios', () => {
  it('lee la tabla por columnas: valor, unidad, segundo valor y referencia en varios renglones', async () => {
    const data = buildColumnPdf([
      [50, 790, 'LABORATORIO CENTRAL'],
      [50, 776, 'Paciente:'],
      [120, 776, 'GOMEZ, ANA'],
      [50, 762, 'DNI 30111222'],
      [400, 762, 'Protocolo 884512'],
      [50, 730, 'Hemoglobina'],
      [250, 730, '13,5'],
      [300, 730, 'g/dL'],
      [400, 730, '12,0 - 16,0'],
      [50, 716, 'Neutrofilos'],
      [250, 716, '61,3%'],
      [300, 716, '4810/mm3'],
      [400, 716, 'Adultos: 41-69 %'],
      [400, 702, 'Ninos: 23-61 %'],
      [50, 680, 'Colesterol HDL'],
      [50, 666, 'Metodo: Enzimatico'],
      [50, 652, 'Resultado'],
      [250, 652, '52 mg/dl'],
      [400, 652, 'Hombres'],
      [400, 638, 'Mayor de 55 mg/dl'],
      [400, 624, 'Mujeres'],
      [400, 610, 'Mayor de 65 mg/dl'],
      [400, 580, 'Bioquimica - M.P. 0000'],
    ])
    const before = store.reports.length
    const created = await createLabReportFromPdf({ ...scope, audit: uploadAudit, userId: 'user_1', fileName: 'GOMEZ_ANA.pdf', data })
    expect(created).toMatchObject({ rowCount: 4, reviewCount: 1 })

    const stored = store.reports[before]!
    const content = labReportContentSchema.parse(JSON.parse(decryptClinicalContent(String(stored.contentEncrypted))))
    expect(content.rows.map((row) => [row.analyte, row.printedValue, row.value, row.unit, row.referenceRange, row.status])).toEqual([
      ['Hemoglobina', '13,5', 13.5, 'g/dL', '12,0 - 16,0', 'read'],
      ['Neutrofilos', '61,3', 61.3, '%', 'Adultos: 41-69 % · Ninos: 23-61 %', 'read'],
      ['Neutrofilos (/mm3)', '4810', 4810, '/mm3', null, 'review'],
      ['Colesterol HDL', '52', 52, 'mg/dl', 'Hombres: Mayor de 55 mg/dl · Mujeres: Mayor de 65 mg/dl', 'read'],
    ])
    for (const leaked of ['GOMEZ', '30111222', '884512']) expect(content.transcription).not.toContain(leaked)
    expect(content.unparsedLines).toEqual([])
    // Cada fila cita un renglón de la transcripción que contiene su valor impreso.
    const lines = content.transcription.split('\n')
    expect(content.rows.every((row) => row.sourceLine !== null && lines[row.sourceLine]!.includes(row.printedValue))).toBe(true)
  })
})
