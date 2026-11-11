import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../../lib/chat/persistence'
import { validatePdfUpload } from '../../../../../../../lib/documents/pdf-upload-validation'
import { isOsEnabled } from '../../../../../../../lib/flags'
import { MAX_LAB_PDF_BYTES } from '../../../../../../../lib/labs/lab-report-content'
import { labReportErrorResponse } from '../../../../../../../lib/labs/lab-report-http'
import { createLabReportFromPdf, LabReportError } from '../../../../../../../lib/labs/lab-report-service'
import { PhiConfigError } from '../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Margen para los límites del multipart alrededor del archivo. */
const MAX_BODY_BYTES = MAX_LAB_PDF_BYTES + 64 * 1024

/**
 * POST — sube el PDF digital de un laboratorio para un sujeto. Lee el texto
 * localmente, tapa el encabezado, interpreta los renglones y deja el informe
 * pendiente de revisión humana (URS-007). El archivo no se guarda.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: studyId, subjectId } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  // Auth antes de leer el cuerpo: sin acceso al sujeto no se procesa ningún archivo.
  let access: Awaited<ReturnType<typeof validateSubjectAccess>>
  try {
    access = await validateSubjectAccess(subjectId, studyId)
  } catch (err) {
    return handleApiError(err)
  }

  // Corte temprano si el tamaño viene declarado. Si no viene (envío por partes),
  // el tope lo ponen la plataforma y el control del archivo más abajo.
  const declaredHeader = req.headers.get('content-length')
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader)
    if (!Number.isFinite(declared) || declared < 0) return new Response('Bad Request', { status: 400 })
    if (declared > MAX_BODY_BYTES) return new Response('Payload Too Large', { status: 413 })
  }

  let file: FormDataEntryValue | null
  try {
    file = (await req.formData()).get('file')
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  if (!(file instanceof File)) return new Response('Bad Request', { status: 400 })
  if (file.size > MAX_LAB_PDF_BYTES) return new Response('Payload Too Large', { status: 413 })
  const verdict = await validatePdfUpload(file)
  if (verdict === 'too_large') return new Response('Payload Too Large', { status: 413 })
  if (verdict !== 'ok') return Response.json({ error: 'not_pdf' }, { status: 415 })

  try {
    const created = await createLabReportFromPdf({
      orgId: access.orgId,
      studyId,
      subjectId,
      userId: access.userId,
      fileName: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    })

    await writeAuditLog({
      action: 'lab.extract',
      orgId: access.orgId,
      studyId,
      userId: access.userId,
      resourceType: 'lab_report',
      resourceId: created.reportId,
      metadata: {
        subjectId,
        source: 'pdf_text',
        rowCount: created.rowCount,
        reviewCount: created.reviewCount,
        newFieldCount: created.newFieldCount,
      },
    })

    return Response.json(created, { status: 201 })
  } catch (err) {
    // Solo el código y el tamaño: nunca el nombre ni el contenido del archivo.
    const known = labReportErrorResponse(err)
    if (known) {
      console.warn('[labs/upload] rejected', { code: err instanceof LabReportError ? err.code : 'unknown', bytes: file.size })
      return known
    }
    if (err instanceof PhiConfigError) {
      console.error('[labs/upload] phi encryption not configured')
      return new Response('Service Unavailable', { status: 503 })
    }
    console.error('[labs/upload] failed', { name: err instanceof Error ? err.name : 'unknown', bytes: file.size })
    return handleApiError(err)
  }
}
