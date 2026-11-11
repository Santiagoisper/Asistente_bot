import {
  mergeConfirmedLabs,
  mergeTextReadings,
  normalizeAnalyteKey,
  numericReadings,
  parseLabReportText,
  rowIsGrounded,
  type LabObservation,
} from '@ichtys/clinical'
import { and, db, eq, inArray, labAnalytes, labReportImages, labReports, type LabReportStatus } from '@ichtys/db'
import { parsePdf, PdfParseError } from '@ichtys/ingestion/parser'
import { readTextWithModel, secondReaderEnabled } from './lab-model-reader'
import { loadPatientProfile, persistPatientProfile } from '../subjects/patient-profile-service'
import { decryptClinicalContent, encryptClinicalContent } from '../subjects/phi-fields'
import {
  labReportContentSchema,
  MAX_LAB_PDF_PAGES,
  type LabReportContent,
  type LabReportRow,
  type LabRowInput,
} from './lab-report-content'

export type LabReportErrorCode =
  | 'not_found'
  | 'already_reviewed'
  | 'no_text'
  | 'unreadable'
  | 'too_many_pages'
  | 'no_rows'
  | 'invalid_rows'
  | 'bad_image'
  | 'reader_unavailable'

/** Error del módulo. El código es estable; nunca lleva texto del documento. */
export class LabReportError extends Error {
  constructor(readonly code: LabReportErrorCode) {
    super(`lab report: ${code}`)
    this.name = 'LabReportError'
  }
}

export interface SubjectScope {
  orgId: string
  studyId: string
  subjectId: string
}

function sanitizeFileName(name: string): string {
  // El nombre del archivo suele traer el apellido del paciente: no se guarda.
  return name.toLowerCase().endsWith('.pdf') ? 'informe.pdf' : 'informe'
}

export async function knownAnalyteKeys(orgId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const rows = await db
    .select({ key: labAnalytes.normalizedKey })
    .from(labAnalytes)
    .where(and(eq(labAnalytes.organizationId, orgId), inArray(labAnalytes.normalizedKey, keys)))
  return new Set(rows.map((row) => row.key))
}

export interface CreatedLabReport {
  reportId: string
  rowCount: number
  reviewCount: number
  newFieldCount: number
}

export interface LabReaders {
  /** Segunda lectura del texto. Se reemplaza en las pruebas. */
  readText: typeof readTextWithModel
}

/**
 * Lee un PDF digital: tapa el encabezado, interpreta los renglones por reglas
 * y pide una segunda lectura a un modelo. Lo que el modelo propone solo entra
 * si su valor figura carácter por carácter en el texto. Si el modelo no
 * responde, quedan las filas de las reglas. El informe queda pendiente de
 * revisión.
 */
export async function createLabReportFromPdf(
  params: SubjectScope & { userId: string; fileName: string; data: Uint8Array },
  readers: LabReaders = { readText: readTextWithModel },
): Promise<CreatedLabReport> {
  let text: string
  try {
    // Cada renglón del informe es un resultado: se pide el texto con sus renglones.
    const document = await parsePdf(params.data, { preserveLines: true })
    if (document.pageCount > MAX_LAB_PDF_PAGES) throw new LabReportError('too_many_pages')
    text = document.pages.map((page) => page.rawText).join('\n')
  } catch (err) {
    if (err instanceof LabReportError) throw err
    if (err instanceof PdfParseError && err.code === 'pdf_contains_no_extractable_text') {
      throw new LabReportError('no_text')
    }
    throw new LabReportError('unreadable')
  }

  const parsed = parseLabReportText(text)
  // Al modelo le llega la transcripción, que ya no tiene el encabezado.
  const second = secondReaderEnabled() && parsed.lines.some((line) => /\d/.test(line))
    ? await readers.readText({ orgId: params.orgId, studyId: params.studyId }, parsed.lines).catch(() => null)
    : null
  const merged = mergeTextReadings(parsed.rows, second?.result ?? null, parsed.lines)
  if (merged.rows.length === 0) throw new LabReportError('no_rows')
  if (merged.dropped > 0) console.warn('[labs] second reading: rows without backing dropped', { dropped: merged.dropped })

  const keys = [...new Set(merged.rows.map((row) => normalizeAnalyteKey(row.analyte)))]
  const known = await knownAnalyteKeys(params.orgId, keys)

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
    fileName: sanitizeFileName(params.fileName),
    transcription: parsed.transcription,
    unparsedLines: parsed.unparsedLines,
    piiRedactedCount: parsed.piiRedactedCount,
    rows,
    source: 'pdf_text',
    readers: {
      first: 'reglas',
      second: second?.provider ?? null,
      agreed: merged.agreed,
      disagreements: second ? merged.rows.length - merged.agreed : 0,
    },
  })

  const [created] = await db
    .insert(labReports)
    .values({
      organizationId: params.orgId,
      studyId: params.studyId,
      subjectId: params.subjectId,
      status: 'pending_review',
      sourceKind: 'pdf_text',
      contentEncrypted: encryptClinicalContent(JSON.stringify(content)),
      rowCount: rows.length,
      createdBy: params.userId,
    })
    .returning({ id: labReports.id })
  if (!created) throw new LabReportError('unreadable')

  return {
    reportId: created.id,
    rowCount: rows.length,
    reviewCount: rows.filter((row) => row.status === 'review').length,
    newFieldCount: rows.filter((row) => row.isNewField).length,
  }
}

export interface LoadedLabReport {
  id: string
  status: LabReportStatus
  createdAt: Date
  reviewedAt: Date | null
  content: LabReportContent
}

export async function loadLabReport(params: SubjectScope & { reportId: string }): Promise<LoadedLabReport> {
  const [row] = await db
    .select()
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
  if (!row) throw new LabReportError('not_found')

  const content = labReportContentSchema.parse(JSON.parse(decryptClinicalContent(row.contentEncrypted)))
  return { id: row.id, status: row.status, createdAt: row.createdAt, reviewedAt: row.reviewedAt, content }
}

/**
 * Borra las imágenes de un informe ya revisado. La imagen solo existe para
 * que la persona compare; después de confirmar o rechazar no se conserva.
 */
export async function purgeLabReportImages(params: { orgId: string; reportId: string }): Promise<void> {
  try {
    await db.delete(labReportImages).where(and(eq(labReportImages.reportId, params.reportId), eq(labReportImages.organizationId, params.orgId)))
  } catch {
    // El informe ya cambió de estado; el borrado se reintenta en la próxima lectura de la imagen.
    console.error('[labs] image purge failed')
  }
}

/** Lecturas numéricas admitidas para un valor impreso (definidas junto al intérprete). */
export const allowedReadings = numericReadings

/**
 * Convierte lo que envía quien revisa en filas finales. Lanza `invalid_rows`
 * si una fila dice venir del informe pero su valor no está en ese renglón, o
 * si el número elegido no es una lectura posible del valor impreso.
 */
export function finalizeRows(input: LabRowInput[], lines: string[], known: Set<string>): LabReportRow[] {
  return input.map((row, index) => {
    const fromReport = row.sourceLine !== null
    if (fromReport && !rowIsGrounded({ printedValue: row.printedValue, sourceLine: row.sourceLine ?? -1 }, lines)) {
      throw new LabReportError('invalid_rows')
    }
    if (!allowedReadings(row.printedValue).includes(row.value)) throw new LabReportError('invalid_rows')
    return {
      id: `r${index + 1}`,
      analyte: row.analyte,
      printedValue: row.printedValue,
      value: row.value,
      unit: row.unit,
      referenceRange: row.referenceRange,
      sourceLine: row.sourceLine,
      status: fromReport ? 'read' : 'manual',
      isNewField: !known.has(normalizeAnalyteKey(row.analyte)),
      reviewReason: null,
    }
  })
}

export interface ConfirmedLabReport {
  rowCount: number
  newAnalytes: number
  /** false si el informe quedó confirmado pero no se pudo sumar al perfil del sujeto. */
  profileUpdated: boolean
}

export async function confirmLabReport(
  params: SubjectScope & { reportId: string; userId: string; rows: LabRowInput[]; comparedWithImage?: boolean },
): Promise<ConfirmedLabReport> {
  const report = await loadLabReport(params)
  if (report.status !== 'pending_review') throw new LabReportError('already_reviewed')
  // Lo leído de una imagen no tiene texto que lo respalde: lo respalda quien confirma.
  if (report.content.source === 'image' && params.comparedWithImage !== true) throw new LabReportError('invalid_rows')

  const keyOf = new Map(params.rows.map((row) => [normalizeAnalyteKey(row.analyte), row]))
  keyOf.delete('')
  const known = await knownAnalyteKeys(params.orgId, [...keyOf.keys()])
  const rows = finalizeRows(params.rows, report.content.transcription.split('\n'), known)
  const content: LabReportContent = labReportContentSchema.parse({ ...report.content, rows, imagePages: 0 })

  // La transición de estado es la que decide: si otra confirmación llegó
  // primero (doble clic), acá no se actualiza ninguna fila y se corta.
  const claimed = await db
    .update(labReports)
    .set({
      status: 'confirmed',
      contentEncrypted: encryptClinicalContent(JSON.stringify(content)),
      rowCount: rows.length,
      reviewedBy: params.userId,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(labReports.id, params.reportId),
        eq(labReports.organizationId, params.orgId),
        eq(labReports.subjectId, params.subjectId),
        eq(labReports.status, 'pending_review'),
      ),
    )
    .returning({ id: labReports.id })
  if (claimed.length === 0) throw new LabReportError('already_reviewed')
  await purgeLabReportImages(params)

  const fresh = [...keyOf.entries()].filter(([key]) => !known.has(key))
  if (fresh.length > 0) {
    await db
      .insert(labAnalytes)
      .values(
        fresh.map(([key, row]) => ({
          organizationId: params.orgId,
          name: row.analyte,
          normalizedKey: key,
          unit: row.unit,
          createdBy: params.userId,
        })),
      )
      .onConflictDoNothing()
  }

  // El perfil del sujeto es una copia de trabajo para screening. Si falla, el
  // informe ya quedó confirmado: se avisa en vez de esconderlo.
  let profileUpdated = true
  try {
    const numeric: LabObservation[] = rows
      .filter((row): row is LabReportRow & { value: number } => row.value !== null)
      .map((row) => ({ name: row.analyte, value: row.value, ...(row.unit ? { unit: row.unit } : {}) }))
    if (numeric.length > 0) {
      const profile = await loadPatientProfile(params)
      await persistPatientProfile({
        ...params,
        profile: { ...profile, labs: mergeConfirmedLabs(profile.labs, numeric), lastUpdatedAt: new Date().toISOString() },
      })
    }
  } catch {
    console.error('[labs] profile merge failed after confirm')
    profileUpdated = false
  }

  return { rowCount: rows.length, newAnalytes: fresh.length, profileUpdated }
}

export async function rejectLabReport(params: SubjectScope & { reportId: string; userId: string }): Promise<void> {
  const rejected = await db
    .update(labReports)
    .set({ status: 'rejected', reviewedBy: params.userId, reviewedAt: new Date() })
    .where(
      and(
        eq(labReports.id, params.reportId),
        eq(labReports.organizationId, params.orgId),
        eq(labReports.studyId, params.studyId),
        eq(labReports.subjectId, params.subjectId),
        eq(labReports.status, 'pending_review'),
      ),
    )
    .returning({ id: labReports.id })
  if (rejected.length > 0) {
    await purgeLabReportImages(params)
    return
  }

  // No se actualizó nada: o no existe para este sujeto, o ya fue revisado.
  await loadLabReport(params)
  throw new LabReportError('already_reviewed')
}
