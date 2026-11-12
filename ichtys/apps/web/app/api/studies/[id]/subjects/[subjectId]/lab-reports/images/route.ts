import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { isOsEnabled } from '../../../../../../../../lib/flags'
import { createLabReportFromImages, validateLabImages } from '../../../../../../../../lib/labs/lab-image-report'
import { MAX_LAB_IMAGE_BYTES, MAX_LAB_IMAGES, MAX_LAB_PDF_BYTES } from '../../../../../../../../lib/labs/lab-report-content'
import { labReportErrorResponse } from '../../../../../../../../lib/labs/lab-report-http'
import { LabReportError } from '../../../../../../../../lib/labs/lab-report-service'
import { PhiConfigError } from '../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'
// Dos lecturas con modelo en paralelo.
export const maxDuration = 120

const MAX_BODY_BYTES = MAX_LAB_PDF_BYTES + 64 * 1024

/**
 * POST — sube las imágenes ya recortadas de un informe (foto o escaneo) para
 * un sujeto. Se leen dos veces; lo que no coincide queda para decidir. La
 * imagen se guarda cifrada solo hasta que el informe se confirma o se rechaza.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: studyId, subjectId } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  // Auth antes de leer el cuerpo: sin acceso al sujeto no se procesa ninguna imagen.
  let access: Awaited<ReturnType<typeof validateSubjectAccess>>
  try {
    access = await validateSubjectAccess(subjectId, studyId, { require: 'labs.manage' })
  } catch (err) {
    return handleApiError(err)
  }

  const declaredHeader = req.headers.get('content-length')
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader)
    if (!Number.isFinite(declared) || declared < 0) return new Response('Bad Request', { status: 400 })
    if (declared > MAX_BODY_BYTES) return new Response('Payload Too Large', { status: 413 })
  }

  let files: File[]
  try {
    files = (await req.formData()).getAll('image').filter((entry): entry is File => entry instanceof File)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  if (files.length === 0) return Response.json({ error: 'bad_image' }, { status: 400 })
  if (files.length > MAX_LAB_IMAGES) return new Response('Payload Too Large', { status: 413 })
  if (files.some((file) => file.size > MAX_LAB_IMAGE_BYTES) || files.reduce((total, file) => total + file.size, 0) > MAX_LAB_PDF_BYTES) {
    return new Response('Payload Too Large', { status: 413 })
  }

  const bytes = files.reduce((total, file) => total + file.size, 0)
  try {
    const images = validateLabImages(await Promise.all(files.map(async (file) => ({ data: new Uint8Array(await file.arrayBuffer()) }))))
    const created = await createLabReportFromImages({
      orgId: access.orgId,
      studyId,
      subjectId,
      userId: access.userId,
      images,
      // Se escribe en la misma transacción que crea el informe y guarda las imágenes (R3).
      audit: (report) => ({
        action: 'lab.extract',
        orgId: access.orgId,
        studyId,
        userId: access.userId,
        resourceType: 'lab_report',
        resourceId: report.reportId,
        metadata: {
          subjectId,
          source: 'image',
          pages: images.length,
          rowCount: report.rowCount,
          reviewCount: report.reviewCount,
          newFieldCount: report.newFieldCount,
        },
      }),
    })

    return Response.json(created, { status: 201 })
  } catch (err) {
    // Solo el código y el tamaño: nunca el contenido.
    const known = labReportErrorResponse(err)
    if (known) {
      console.warn('[labs/upload-image] rejected', { code: err instanceof LabReportError ? err.code : 'unknown', pages: files.length, bytes })
      return known
    }
    if (err instanceof PhiConfigError) {
      console.error('[labs/upload-image] phi encryption not configured')
      return new Response('Service Unavailable', { status: 503 })
    }
    console.error('[labs/upload-image] failed', { name: err instanceof Error ? err.name : 'unknown', pages: files.length, bytes })
    return handleApiError(err)
  }
}
