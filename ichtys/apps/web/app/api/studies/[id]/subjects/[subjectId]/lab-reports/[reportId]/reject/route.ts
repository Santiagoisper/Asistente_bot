import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { isOsEnabled } from '../../../../../../../../../lib/flags'
import { isUuid, labReportErrorResponse } from '../../../../../../../../../lib/labs/lab-report-http'
import { rejectLabReport } from '../../../../../../../../../lib/labs/lab-report-service'

export const runtime = 'nodejs'

/** POST — descarta el informe sin pasar ningún valor al registro. Un informe ya revisado da 409. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string; reportId: string }> },
): Promise<Response> {
  const { id: studyId, subjectId, reportId } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  try {
    const access = await validateSubjectAccess(subjectId, studyId, { require: 'labs.manage' })
    if (!isUuid(reportId)) return Response.json({ error: 'not_found' }, { status: 404 })

    await rejectLabReport({
      orgId: access.orgId,
      studyId,
      subjectId,
      reportId,
      userId: access.userId,
      // Se escribe dentro de la transacción que rechaza el informe (R3).
      audit: (facts) => ({
        action: 'lab.reject',
        orgId: access.orgId,
        studyId,
        userId: access.userId,
        resourceType: 'lab_report',
        resourceId: reportId,
        metadata: { subjectId, imagesPurged: facts.imagesPurged },
      }),
    })

    return Response.json({ status: 'rejected' })
  } catch (err) {
    const known = labReportErrorResponse(err)
    if (known) return known
    return handleApiError(err)
  }
}
