import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Lectura exacta, de punta a punta, con la base en memoria y los modelos
 * reemplazados por lecturas escritas a mano. Lo que se prueba es lo que el
 * programa hace con lo que un modelo devuelve: qué acepta, qué descarta y qué
 * obliga a decidir.
 */
const store = vi.hoisted(() => ({
  reports: [] as Array<Record<string, unknown>>,
  images: [] as Array<Record<string, unknown>>,
  analytes: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  deletes: [] as Array<{ via: 'db' | 'tx'; count: number }>,
  failAudit: false,
  persisted: [] as Array<{ labs: Array<{ name: string; value: number; unit?: string }> }>,
}))

vi.mock('@ichtys/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ichtys/db')>()
  const is = (table: unknown, target: unknown) => table === target
  // `via` deja asentado por dónde entró cada escritura: por la conexión suelta
  // ('db') o por la transacción ('tx').
  const make = (via: 'db' | 'tx') => ({
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(values) ? values : [values]
        if (is(table, original.auditLogs)) {
          if (store.failAudit) return Promise.reject(new Error('audit insert failed'))
          store.audits.push({ via, ...list[0] })
          return Promise.resolve()
        }
        if (is(table, original.labReports)) {
          const row = { id: `0000000${store.reports.length + 1}-0000-4000-8000-000000000000`, createdAt: new Date(), reviewedAt: null, ...list[0] }
          store.reports.push(row)
          return { returning: async () => [{ id: row.id }] }
        }
        if (is(table, original.labReportImages)) {
          store.images.push(...list)
          return Promise.resolve()
        }
        return {
          onConflictDoNothing: async () => {
            for (const value of list) if (!store.analytes.some((entry) => entry.normalizedKey === value.normalizedKey)) store.analytes.push(value)
          },
        }
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = is(table, original.labReports)
            ? store.reports.slice(-1)
            : is(table, original.labReportImages)
              ? store.images
              : store.analytes.map((entry) => ({ key: entry.normalizedKey }))
          return Object.assign(Promise.resolve(rows), { limit: async () => rows })
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const report = store.reports[store.reports.length - 1]
            if (!report || report.status !== 'pending_review') return []
            Object.assign(report, values, { claimedVia: via })
            return [{ id: report.id }]
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        const deleted = is(table, original.labReportImages) ? store.images.map((image) => ({ page: image.page })) : []
        if (is(table, original.labReportImages)) {
          store.images.length = 0
          store.deletes.push({ via, count: deleted.length })
        }
        const done = Promise.resolve(deleted)
        return Object.assign(done, { returning: () => done })
      },
    }),
  })
  const db = { ...make('db'), transaction: async <T,>(work: (tx: unknown) => Promise<T>) => work(make('tx')) }
  return { ...original, db }
})

vi.mock('../../subjects/patient-profile-service', () => ({
  updatePatientProfile: vi.fn(async (_scope: unknown, mutate: (current: { labs: [] }) => (typeof store.persisted)[number]) => {
    const next = await mutate({ labs: [] })
    store.persisted.push(next)
    return next
  }),
}))

import type { ImageReading, ReaderRow } from '@ichtys/clinical'
import { decryptClinicalContent } from '../../subjects/phi-fields'
import { createLabReportFromImages, loadLabReportImage, sniffImage, validateLabImages } from '../lab-image-report'
import { labReportContentSchema, type LabReportContent } from '../lab-report-content'
import { confirmLabReport, createLabReportFromPdf, LabReportError, loadLabReport, rejectLabReport } from '../lab-report-service'
import { decideValue, rowProblem, toConfirmPayload, toReviewRow } from '../review-rows'

const scope = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1' }
const uploadAudit = (report: { reportId: string; rowCount: number }) => ({ action: 'lab.extract' as const, orgId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'lab_report', resourceId: report.reportId, metadata: { rowCount: report.rowCount } })
const audit = (facts: { rowCount?: number; newAnalytes?: number; imagesPurged: number; review?: unknown; secondsSinceUpload?: number }) => ({
  action: facts.rowCount === undefined ? ('lab.reject' as const) : ('lab.confirm' as const),
  orgId: 'org-1',
  studyId: 'study-1',
  userId: 'user_2',
  resourceType: 'lab_report',
  resourceId: 'report',
  metadata: { ...facts },
})
const purgeAudit = (facts: { imagesPurged: number }) => ({ action: 'lab.evidence.purge' as const, orgId: 'org-1', studyId: 'study-1', userId: 'user_3', resourceType: 'lab_report', resourceId: 'report', metadata: { ...facts } })
const savedKey = process.env.PHI_ENCRYPTION_KEY
const row = (analyte: string, printedValue: string, line: number, unit: string | null = null): ReaderRow => ({ analyte, printedValue, unit, referenceRange: null, line })
const lastContent = (): LabReportContent => labReportContentSchema.parse(JSON.parse(decryptClinicalContent(String(store.reports[store.reports.length - 1]!.contentEncrypted))))

/** PDF de una página con cada texto en su posición. */
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

/** Un laboratorio con un formato que las reglas no conocen: el valor va antes que el nombre. */
const ODD_LAYOUT = buildColumnPdf([
  [50, 790, 'Paciente: GOMEZ, ANA'],
  [50, 776, 'DNI 30111222'],
  [50, 740, 'Hemoglobina'],
  [250, 740, '13,5'],
  [300, 740, 'g/dL'],
  [50, 726, '92'],
  [120, 726, 'mg/dL'],
  [200, 726, 'corresponde a Glucosa en ayunas'],
])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})
beforeEach(() => {
  store.reports.length = 0
  store.images.length = 0
  store.analytes.length = 0
  store.audits.length = 0
  store.deletes.length = 0
  store.failAudit = false
  store.persisted.length = 0
})

describe('PDF con texto — reglas más segunda lectura', () => {
  const upload = (readText: Parameters<typeof createLabReportFromPdf>[1] extends infer R ? (R extends { readText: infer F } ? F : never) : never) =>
    createLabReportFromPdf({ ...scope, audit: uploadAudit, userId: 'user_1', fileName: 'informe.pdf', data: ODD_LAYOUT }, { readText })

  it('el modelo encuentra lo que las reglas no, y solo entra lo que figura en el texto', async () => {
    let seen: readonly string[] = []
    const created = await upload(async (_scope, lines) => {
      seen = lines
      const at = (needle: string) => lines.findIndex((line) => line.includes(needle))
      return {
        provider: 'openai',
        result: [row('Hemoglobina', '13,5', at('Hemoglobina'), 'g/dL'), row('Glucosa en ayunas', '92', at('corresponde'), 'mg/dL'), row('Urea', '30', at('corresponde')), row('Hemoglobina', '3,5', at('Hemoglobina'))],
      }
    })
    // Al modelo no le llega el encabezado.
    expect(seen.join('\n')).not.toMatch(/GOMEZ|30111222/)
    expect(created).toMatchObject({ rowCount: 2, reviewCount: 1 })
    const content = lastContent()
    expect(content.rows.map((entry) => [entry.analyte, entry.printedValue, entry.value, entry.unit, entry.status])).toEqual([
      ['Hemoglobina', '13,5', 13.5, 'g/dL', 'read'],
      ['Glucosa en ayunas', '92', 92, 'mg/dL', 'review'],
    ])
    expect(content.readers).toEqual({ first: 'reglas', second: 'openai', agreed: 1, disagreements: 1 })
    expect(content.source).toBe('pdf_text')
  })

  it('si el modelo no responde, quedan las filas de las reglas y se dice que hubo una sola lectura', async () => {
    const created = await upload(async () => null)
    expect(created.rowCount).toBe(1)
    expect(lastContent().readers).toMatchObject({ second: null })
  })

  it('si el modelo falla con un error, la carga no se cae', async () => {
    const created = await upload(async () => {
      throw new Error('proveedor caído')
    })
    expect(created.rowCount).toBe(1)
  })

  it('un modelo que inventa todo no agrega ninguna fila', async () => {
    await upload(async () => ({ provider: 'openai', result: [row('Sodio', '140', 2), row('Potasio', '4,2', 3)] }))
    expect(lastContent().rows.map((entry) => entry.analyte)).toEqual(['Hemoglobina'])
  })
})

describe('Foto o escaneo — dos lecturas independientes', () => {
  const lines = ['Hemoglobina 13,5 g/dL', 'Glucosa 92 mg/dL', 'Paciente: GOMEZ ANA', 'Creatinina 0,9 mg/dL']
  const main: ImageReading = { lines, rows: [row('Hemoglobina', '13,5', 0, 'g/dL'), row('Glucosa', '92', 1, 'mg/dL'), row('Creatinina', '0,9', 3, 'mg/dL')] }
  const readers = (control: ImageReading | null, primary: ImageReading | null = main) => ({
    readImages: vi.fn(async (_scope: unknown, _images: unknown, options: { control?: boolean } = {}) => {
      const reading = options.control ? control : primary
      return reading ? { provider: options.control ? ('openai' as const) : ('anthropic' as const), result: reading } : null
    }),
  })
  const images = [{ mime: 'image/jpeg' as const, data: JPEG }, { mime: 'image/png' as const, data: PNG }]
  const upload = (control: ImageReading | null, primary: ImageReading | null = main) => createLabReportFromImages({ ...scope, audit: uploadAudit, userId: 'user_1', images }, readers(control, primary))

  it('las dos coinciden: todo leído, imagen guardada cifrada y sin datos personales en la transcripción', async () => {
    const created = await upload({ lines: [], rows: [...main.rows] })
    expect(created).toMatchObject({ rowCount: 3, reviewCount: 0 })
    const content = lastContent()
    expect(content).toMatchObject({ source: 'image', imagePages: 2, readers: { first: 'anthropic', second: 'openai', agreed: 3, disagreements: 0 } })
    expect(content.transcription).not.toContain('GOMEZ')
    expect(store.reports[0]).toMatchObject({ sourceKind: 'image', status: 'pending_review' })
    expect(store.images.map((image) => [image.page, image.mime, image.organizationId, image.studyId])).toEqual([
      [1, 'image/jpeg', 'org-1', 'study-1'],
      [2, 'image/png', 'org-1', 'study-1'],
    ])
    // Cifrada: el contenido guardado no es el base64 de la imagen.
    expect(String(store.images[0]!.contentEncrypted)).not.toContain(Buffer.from(JPEG).toString('base64'))
    const loaded = await loadLabReportImage({ ...scope, reportId: created.reportId, page: 1, purgeAudit })
    expect(loaded.mime).toBe('image/jpeg')
    expect([...loaded.data]).toEqual([...JPEG])
  })

  it('un dígito distinto bloquea la confirmación hasta que una persona elige', async () => {
    const created = await upload({ lines: [], rows: [row('Hemoglobina', '18,5', 0), row('Glucosa', '92', 1), row('Creatinina', '0,9', 2)] })
    expect(created.reviewCount).toBe(1)
    const report = await loadLabReport({ ...scope, reportId: created.reportId })
    const rows = report.content.rows.map(toReviewRow)
    expect(rows.map(rowProblem)).toEqual(['needs_decision', null, null])
    expect(rows[0]).toMatchObject({ printedValue: '13,5', alternative: '18,5' })
    expect(toConfirmPayload(rows)).toBeNull()

    // Elige la otra lectura: deja de citar el renglón (no figura ahí) y pasa a ser una corrección a mano.
    const decided = rows.map((entry, index) => (index === 0 ? decideValue(entry, '18,5', report.content.transcription.split('\n')) : entry))
    expect(decided[0]).toMatchObject({ printedValue: '18,5', reading: 18.5, sourceLine: null, needsDecision: false })
    const payload = toConfirmPayload(decided)!

    // Sin la declaración de que comparó con la imagen, el servidor no confirma.
    await expect(confirmLabReport({ ...scope, reportId: created.reportId, userId: 'user_2', rows: payload, audit })).rejects.toMatchObject({ code: 'invalid_rows' })
    expect(store.reports[0]?.status).toBe('pending_review')
    expect(store.images).toHaveLength(2)
    // Lo que no se confirmó no deja registro de confirmación: solo está el de la carga,
    // escrito en la misma transacción que creó el informe.
    expect(store.audits).toEqual([expect.objectContaining({ via: 'tx', action: 'lab.extract', resourceId: created.reportId, metadata: { rowCount: 3 } })])

    const result = await confirmLabReport({ ...scope, reportId: created.reportId, userId: 'user_2', rows: payload, comparedWithImage: true, audit })
    expect(result).toMatchObject({ rowCount: 3, profileUpdated: true })
    // R3: el cambio de estado y su registro entran por la misma transacción.
    expect(store.reports[0]).toMatchObject({ status: 'confirmed', claimedVia: 'tx' })
    expect(store.audits.map((entry) => entry.action)).toEqual(['lab.extract', 'lab.confirm'])
    expect(store.audits[1]).toMatchObject({ via: 'tx', action: 'lab.confirm', metadata: { rowCount: 3, newAnalytes: 3, imagesPurged: 0 } })
    // Medición del piloto: cada fila leída cae en una sola categoría, y el registro lleva solo cuentas.
    const review = (store.audits[1]!.metadata as { review: Record<string, number>; secondsSinceUpload: number }).review
    expect(review.machineRows).toBe(3)
    expect(review.unchanged! + review.valueCorrected! + review.decided! + review.labelCorrected! + review.removed!).toBe(review.machineRows)
    expect(result.review).toEqual(review)
    expect((store.audits[1]!.metadata as { secondsSinceUpload: number }).secondsSinceUpload).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(store.audits[1]!.metadata)).not.toContain('Hemoglobina')
    expect(store.deletes).toEqual([])
    // Cada valor guarda de qué informe salió (C4, D1).
    const source = { kind: 'lab_report', reportId: created.reportId }
    expect(store.persisted[0]?.labs).toEqual([
      { name: 'Hemoglobina', value: 18.5, unit: 'g/dL', source },
      { name: 'Glucosa', value: 92, unit: 'mg/dL', source },
      { name: 'Creatinina', value: 0.9, unit: 'mg/dL', source },
    ])
    // Confirmado: por defecto la evidencia se conserva y se puede volver a ver.
    expect(store.images).toHaveLength(2)
    expect(lastContent().imagePages).toBe(2)
    expect((await loadLabReportImage({ ...scope, reportId: created.reportId, page: 1, purgeAudit })).mime).toBe('image/jpeg')
  })

  it('con política de borrado, confirmar borra la imagen y ya no se puede pedir', async () => {
    process.env.LAB_EVIDENCE_RETENTION = 'purge'
    try {
      const created = await upload({ lines: [], rows: [...main.rows] })
      const report = await loadLabReport({ ...scope, reportId: created.reportId })
      await confirmLabReport({ ...scope, reportId: created.reportId, userId: 'user_2', rows: toConfirmPayload(report.content.rows.map(toReviewRow))!, comparedWithImage: true, audit })
      expect(store.images).toHaveLength(0)
      expect(lastContent().imagePages).toBe(0)
      // R3: el borrado de la evidencia entra por la misma transacción que la
      // confirmación, y el registro dice cuántas imágenes se borraron.
      expect(store.deletes).toEqual([{ via: 'tx', count: 2 }])
      expect(store.audits.at(-1)).toMatchObject({ via: 'tx', action: 'lab.confirm', metadata: { imagesPurged: 2 } })
      await expect(loadLabReportImage({ ...scope, reportId: created.reportId, page: 1, purgeAudit })).rejects.toMatchObject({ code: 'not_found' })
      // No quedaba nada por borrar: pedir la imagen no suma un registro de borrado.
      expect(store.audits.map((entry) => entry.action)).not.toContain('lab.evidence.purge')
    } finally {
      delete process.env.LAB_EVIDENCE_RETENTION
    }
  })

  it('si la política pasa a borrar después de revisado, la imagen que quedaba se borra con su registro', async () => {
    const created = await upload({ lines: [], rows: [...main.rows] })
    const report = await loadLabReport({ ...scope, reportId: created.reportId })
    await confirmLabReport({ ...scope, reportId: created.reportId, userId: 'user_2', rows: toConfirmPayload(report.content.rows.map(toReviewRow))!, comparedWithImage: true, audit })
    expect(store.images).toHaveLength(2)

    process.env.LAB_EVIDENCE_RETENTION = 'purge'
    try {
      await expect(loadLabReportImage({ ...scope, reportId: created.reportId, page: 1, purgeAudit })).rejects.toMatchObject({ code: 'not_found' })
      expect(store.images).toHaveLength(0)
      expect(store.deletes).toEqual([{ via: 'tx', count: 2 }])
      expect(store.audits.at(-1)).toMatchObject({ via: 'tx', action: 'lab.evidence.purge', metadata: { imagesPurged: 2 } })

      // Si el registro no se puede escribir, la lectura sigue respondiendo «no existe»
      // y el error no sale hacia afuera.
      store.failAudit = true
      await expect(loadLabReportImage({ ...scope, reportId: created.reportId, page: 1, purgeAudit })).rejects.toMatchObject({ code: 'not_found' })
    } finally {
      store.failAudit = false
      delete process.env.LAB_EVIDENCE_RETENTION
    }
  })

  it('"Lo comparé" sobre el mismo valor lo da por decidido sin cambiarlo', async () => {
    const created = await upload({ lines: [], rows: [row('Hemoglobina', '13,5', 0), row('Glucosa', '92', 1)] })
    const report = await loadLabReport({ ...scope, reportId: created.reportId })
    const rows = report.content.rows.map(toReviewRow)
    expect(rows.map(rowProblem)).toEqual([null, null, 'needs_decision'])
    const decided = decideValue(rows[2]!, '0,9', report.content.transcription.split('\n'))
    expect(decided).toMatchObject({ printedValue: '0,9', sourceLine: 3, needsDecision: false, reviewReason: null })
  })

  it('una sola lectura: nada queda como leído y la pantalla lo va a decir', async () => {
    const created = await upload(null)
    expect(created).toMatchObject({ rowCount: 3, reviewCount: 3 })
    expect(lastContent().readers).toMatchObject({ first: 'anthropic', second: null, agreed: 0 })
  })

  it('si solo responde la lectura de control, se usa como única lectura', async () => {
    const created = await upload({ lines, rows: main.rows }, null)
    expect(created.rowCount).toBe(3)
    expect(lastContent().readers).toMatchObject({ first: 'openai', second: null })
  })

  it('si ninguna lectura responde no se crea nada', async () => {
    await expect(upload(null, null)).rejects.toMatchObject({ code: 'reader_unavailable' })
    expect(store.reports).toHaveLength(0)
    expect(store.images).toHaveLength(0)
  })

  it('rechazar conserva la imagen por defecto y la borra solo con política de borrado', async () => {
    const kept = await upload({ lines: [], rows: [...main.rows] })
    await rejectLabReport({ ...scope, reportId: kept.reportId, userId: 'user_2', audit })
    expect(store.reports[0]).toMatchObject({ status: 'rejected', claimedVia: 'tx' })
    expect(store.audits.map((entry) => entry.action)).toEqual(['lab.extract', 'lab.reject'])
    expect(store.audits[1]).toMatchObject({ via: 'tx', action: 'lab.reject' })

    // Rechazar de nuevo lo ya rechazado se corta y no suma otro registro.
    await expect(rejectLabReport({ ...scope, reportId: kept.reportId, userId: 'user_2', audit })).rejects.toMatchObject({ code: 'already_reviewed' })
    expect(store.audits).toHaveLength(2)

    // Si el registro no se puede escribir, el rechazo falla entero: no se da por hecho.
    store.reports.length = 0
    store.audits.length = 0
    const unaudited = await upload({ lines: [], rows: [...main.rows] })
    store.failAudit = true
    await expect(rejectLabReport({ ...scope, reportId: unaudited.reportId, userId: 'user_2', audit })).rejects.toThrow('audit insert failed')
    // Lo mismo al cargar: sin registro, la carga falla y no devuelve un informe.
    await expect(upload({ lines: [], rows: [...main.rows] })).rejects.toThrow('audit insert failed')
    store.failAudit = false
    store.reports.length = 0
    store.images.length = 0
    const kept2 = await upload({ lines: [], rows: [...main.rows] })
    expect(kept2.reportId).toBeTruthy()
    expect(store.images).toHaveLength(2)

    process.env.LAB_EVIDENCE_RETENTION = 'purge'
    try {
      store.reports.length = 0
      store.images.length = 0
      const purged = await upload({ lines: [], rows: [...main.rows] })
      store.deletes.length = 0
      await rejectLabReport({ ...scope, reportId: purged.reportId, userId: 'user_2', audit })
      expect(store.images).toHaveLength(0)
      expect(store.deletes).toEqual([{ via: 'tx', count: 2 }])
      expect(store.audits.at(-1)).toMatchObject({ via: 'tx', action: 'lab.reject', metadata: { imagesPurged: 2 } })
    } finally {
      delete process.env.LAB_EVIDENCE_RETENTION
    }
  })

  it('la política por defecto es conservar: borrar hay que pedirlo', async () => {
    const { evidenceRetention } = await import('../evidence-policy')
    delete process.env.LAB_EVIDENCE_RETENTION
    expect(evidenceRetention()).toBe('keep')
    process.env.LAB_EVIDENCE_RETENTION = 'cualquier cosa'
    expect(evidenceRetention()).toBe('keep')
    process.env.LAB_EVIDENCE_RETENTION = ' PURGE '
    expect(evidenceRetention()).toBe('purge')
    delete process.env.LAB_EVIDENCE_RETENTION
  })
})

describe('validación de imágenes', () => {
  it('reconoce JPEG, PNG y WebP por sus bytes, no por el nombre', () => {
    const webp = new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBP'), 1])
    expect([sniffImage(JPEG), sniffImage(PNG), sniffImage(webp), sniffImage(new TextEncoder().encode('%PDF-1.4'))]).toEqual(['image/jpeg', 'image/png', 'image/webp', null])
  })

  it('rechaza un archivo que no es imagen, una lista vacía, más de seis hojas y una hoja demasiado grande', () => {
    const bad = (files: Array<{ data: Uint8Array }>) => {
      try {
        validateLabImages(files)
        return 'ok'
      } catch (err) {
        return err instanceof LabReportError ? err.code : 'otro'
      }
    }
    expect(bad([{ data: new TextEncoder().encode('<svg onload=alert(1)>') }])).toBe('bad_image')
    expect(bad([])).toBe('bad_image')
    expect(bad(Array.from({ length: 7 }, () => ({ data: JPEG })))).toBe('bad_image')
    const huge = new Uint8Array(1_500_001)
    huge.set(JPEG)
    expect(bad([{ data: huge }])).toBe('bad_image')
    expect(bad([{ data: JPEG }])).toBe('ok')
  })
})
