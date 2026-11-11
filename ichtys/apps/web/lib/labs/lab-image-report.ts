import { mergeImageReadings, normalizeAnalyteKey, redactIdentifyingLines } from '@ichtys/clinical'
import { and, db, eq, labReportImages, labReports } from '@ichtys/db'
import { encryptClinicalContent, decryptClinicalContent } from '../subjects/phi-fields'
import { evidenceRetention } from './evidence-policy'
import { readImagesWithModel, type LabImage } from './lab-model-reader'
import {
  LAB_IMAGE_MIMES,
  labReportContentSchema,
  MAX_LAB_IMAGE_BYTES,
  MAX_LAB_IMAGES,
  type LabImageMime,
  type LabReportContent,
  type LabReportRow,
} from './lab-report-content'
import { knownAnalyteKeys, LabReportError, purgeLabReportImages, type CreatedLabReport, type SubjectScope } from './lab-report-service'

/**
 * Informes subidos como foto o escaneo. La imagen llega recortada desde el
 * navegador (sin el encabezado), se lee dos veces y se guarda cifrada para que
 * quien revisa la tenga al lado. Cuánto se conserva lo decide evidence-policy.
 */

const MAX_TRANSCRIPTION_LINES = 600
const MAX_LINE_CHARS = 300

/** Tipo real de la imagen según sus primeros bytes; null si no es JPEG, PNG ni WebP. */
export function sniffImage(bytes: Uint8Array): LabImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

/** Valida cantidad, tamaño y tipo real. Devuelve las imágenes con su tipo comprobado. */
export function validateLabImages(files: ReadonlyArray<{ data: Uint8Array }>): LabImage[] {
  if (files.length === 0 || files.length > MAX_LAB_IMAGES) throw new LabReportError('bad_image')
  return files.map((file) => {
    const mime = sniffImage(file.data)
    if (mime === null || !LAB_IMAGE_MIMES.includes(mime) || file.data.length > MAX_LAB_IMAGE_BYTES) throw new LabReportError('bad_image')
    return { mime, data: file.data }
  })
}

export interface LabImageReaders {
  /** Lectura de las imágenes. Se reemplaza en las pruebas. */
  readImages: typeof readImagesWithModel
}

/**
 * Lee las imágenes dos veces, en paralelo y de forma independiente. Lo que
 * coincide queda leído; lo que no, queda para que una persona decida mirando
 * la imagen. Si ninguna lectura responde, no se crea nada.
 */
export async function createLabReportFromImages(
  params: SubjectScope & { userId: string; images: LabImage[] },
  readers: LabImageReaders = { readImages: readImagesWithModel },
): Promise<CreatedLabReport> {
  const scope = { orgId: params.orgId, studyId: params.studyId }
  const [main, control] = await Promise.all([
    readers.readImages(scope, params.images).catch(() => null),
    readers.readImages(scope, params.images, { control: true }).catch(() => null),
  ])
  // Si solo respondió la de control, pasa a ser la única lectura.
  const first = main ?? control
  const second = main ? control : null
  if (!first) throw new LabReportError('reader_unavailable')

  const clean = (lines: readonly string[]) => lines.slice(0, MAX_TRANSCRIPTION_LINES).map((line) => String(line).replace(/\s*\n\s*/g, ' ').slice(0, MAX_LINE_CHARS))
  const redacted = redactIdentifyingLines(clean(first.result.lines))
  const merged = mergeImageReadings(
    { lines: redacted.lines, rows: first.result.rows },
    second ? { lines: redactIdentifyingLines(clean(second.result.lines)).lines, rows: second.result.rows } : null,
  )
  if (merged.rows.length === 0) throw new LabReportError('no_rows')

  const known = await knownAnalyteKeys(params.orgId, [...new Set(merged.rows.map((row) => normalizeAnalyteKey(row.analyte)))])
  const rows: LabReportRow[] = merged.rows.map((row, index) => ({
    id: `r${index + 1}`,
    analyte: row.analyte,
    printedValue: row.printedValue,
    value: row.value,
    unit: row.unit,
    referenceRange: row.referenceRange,
    sourceLine: row.sourceLine,
    status: row.needsReview ? 'review' : 'read',
    isNewField: !known.has(normalizeAnalyteKey(row.analyte)),
    reviewReason: row.reviewReason,
    ...(row.mustDecide ? { mustDecide: true, alternative: row.alternative } : {}),
  }))

  const content: LabReportContent = labReportContentSchema.parse({
    version: 1,
    fileName: 'imagen',
    transcription: merged.lines.join('\n'),
    unparsedLines: [],
    piiRedactedCount: redacted.redacted,
    rows,
    source: 'image',
    imagePages: params.images.length,
    readers: {
      first: first.provider,
      second: second?.provider ?? null,
      agreed: rows.filter((row) => row.status === 'read').length,
      disagreements: merged.disagreements,
    },
  })

  const reportId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(labReports)
      .values({
        organizationId: params.orgId,
        studyId: params.studyId,
        subjectId: params.subjectId,
        status: 'pending_review',
        sourceKind: 'image',
        contentEncrypted: encryptClinicalContent(JSON.stringify(content)),
        rowCount: rows.length,
        createdBy: params.userId,
      })
      .returning({ id: labReports.id })
    if (!created) throw new LabReportError('unreadable')
    await tx.insert(labReportImages).values(
      params.images.map((image, index) => ({
        organizationId: params.orgId,
        studyId: params.studyId,
        reportId: created.id,
        page: index + 1,
        mime: image.mime,
        contentEncrypted: encryptClinicalContent(Buffer.from(image.data).toString('base64')),
      })),
    )
    return created.id
  })

  return {
    reportId,
    rowCount: rows.length,
    reviewCount: rows.filter((row) => row.status === 'review').length,
    newFieldCount: rows.filter((row) => row.isNewField).length,
  }
}

/** Imagen de un informe. Después de revisado, sigue disponible salvo que la política sea borrar. */
export async function loadLabReportImage(params: SubjectScope & { reportId: string; page: number }): Promise<LabImage> {
  const [report] = await db
    .select({ status: labReports.status })
    .from(labReports)
    .where(
      and(
        eq(labReports.id, params.reportId),
        eq(labReports.organizationId, params.orgId),
        eq(labReports.studyId, params.studyId),
        eq(labReports.subjectId, params.subjectId),
      ),
    )
    .limit(1)
  if (!report) throw new LabReportError('not_found')
  // Con política de borrado, un informe ya revisado no tiene imagen (y si quedó alguna, se borra ahora).
  if (report.status !== 'pending_review' && evidenceRetention() === 'purge') {
    await purgeLabReportImages(params)
    throw new LabReportError('not_found')
  }

  const [image] = await db
    .select({ mime: labReportImages.mime, contentEncrypted: labReportImages.contentEncrypted })
    .from(labReportImages)
    .where(and(eq(labReportImages.reportId, params.reportId), eq(labReportImages.organizationId, params.orgId), eq(labReportImages.page, params.page)))
    .limit(1)
  if (!image) throw new LabReportError('not_found')
  const data = new Uint8Array(Buffer.from(decryptClinicalContent(image.contentEncrypted), 'base64'))
  const mime = sniffImage(data)
  if (mime === null) throw new LabReportError('not_found')
  return { mime, data }
}
