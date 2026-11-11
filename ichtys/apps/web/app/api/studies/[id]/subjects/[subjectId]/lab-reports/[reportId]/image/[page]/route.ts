import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { isOsEnabled } from '../../../../../../../../../../lib/flags'
import { loadLabReportImage } from '../../../../../../../../../../lib/labs/lab-image-report'
import { MAX_LAB_IMAGES } from '../../../../../../../../../../lib/labs/lab-report-content'
import { isUuid, labReportErrorResponse } from '../../../../../../../../../../lib/labs/lab-report-http'
import { PhiConfigError } from '../../../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/**
 * GET — imagen recortada de un informe pendiente, para compararla con los
 * campos. No se guarda en caché. Si la política de conservación es borrar, deja
 * de existir cuando el informe se revisa.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string; reportId: string; page: string }> },
): Promise<Response> {
  const { id: studyId, subjectId, reportId, page } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  let access: Awaited<ReturnType<typeof validateSubjectAccess>>
  try {
    access = await validateSubjectAccess(subjectId, studyId)
  } catch (err) {
    return handleApiError(err)
  }
  const pageNumber = Number(page)
  if (!isUuid(reportId) || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_LAB_IMAGES) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  try {
    const image = await loadLabReportImage({ orgId: access.orgId, studyId, subjectId, reportId, page: pageNumber })
    return new Response(Buffer.from(image.data), {
      headers: {
        'content-type': image.mime,
        'content-length': String(image.data.length),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      },
    })
  } catch (err) {
    const known = labReportErrorResponse(err)
    if (known) return known
    if (err instanceof PhiConfigError) return new Response('Service Unavailable', { status: 503 })
    return handleApiError(err)
  }
}
