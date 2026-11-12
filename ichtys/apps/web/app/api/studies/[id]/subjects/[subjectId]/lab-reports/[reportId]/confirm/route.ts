import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../../../../lib/api/body-limit'
import { isOsEnabled } from '../../../../../../../../../lib/flags'
import { labConfirmSchema } from '../../../../../../../../../lib/labs/lab-report-content'
import { isUuid, labReportErrorResponse } from '../../../../../../../../../lib/labs/lab-report-http'
import { confirmLabReport } from '../../../../../../../../../lib/labs/lab-report-service'
import { PhiConfigError } from '../../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/**
 * POST — una persona confirma las filas finales mirando el informe. Recién
 * acá los valores se guardan en Alphi (URS-007); no se envían a ningún otro
 * sistema. Un informe ya revisado da 409.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string; reportId: string }> },
): Promise<Response> {
  const { id: studyId, subjectId, reportId } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  let access: Awaited<ReturnType<typeof validateSubjectAccess>>
  try {
    access = await validateSubjectAccess(subjectId, studyId, { require: 'labs.manage' })
  } catch (err) {
    return handleApiError(err)
  }
  if (!isUuid(reportId)) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) return new Response('Payload Too Large', { status: 413 })
    return new Response('Bad Request', { status: 400 })
  }
  const parsed = labConfirmSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'invalid_rows' }, { status: 400 })

  try {
    const result = await confirmLabReport({
      orgId: access.orgId,
      studyId,
      subjectId,
      reportId,
      userId: access.userId,
      rows: parsed.data.rows,
      comparedWithImage: parsed.data.comparedWithImage,
      // Se escribe dentro de la transacción que confirma el informe (R3). Si el
      // perfil del sujeto se pudo actualizar después no es parte de este
      // registro: eso ocurre ya confirmado y se le informa a quien confirma.
      audit: (facts) => ({
        action: 'lab.confirm',
        orgId: access.orgId,
        studyId,
        userId: access.userId,
        resourceType: 'lab_report',
        resourceId: reportId,
        metadata: { subjectId, comparedWithImage: parsed.data.comparedWithImage === true, rowCount: facts.rowCount, newAnalytes: facts.newAnalytes, imagesPurged: facts.imagesPurged },
      }),
    })

    return Response.json(result)
  } catch (err) {
    const known = labReportErrorResponse(err)
    if (known) return known
    if (err instanceof PhiConfigError) return new Response('Service Unavailable', { status: 503 })
    return handleApiError(err)
  }
}
