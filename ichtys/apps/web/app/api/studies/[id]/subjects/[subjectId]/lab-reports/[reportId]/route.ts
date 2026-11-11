import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../../../lib/chat/persistence'
import { isOsEnabled } from '../../../../../../../../lib/flags'
import { isUuid, labReportErrorResponse } from '../../../../../../../../lib/labs/lab-report-http'
import { loadLabReport } from '../../../../../../../../lib/labs/lab-report-service'
import { PhiConfigError } from '../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/** GET — informe descifrado para revisar. Registra el acceso. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string; reportId: string }> },
): Promise<Response> {
  const { id: studyId, subjectId, reportId } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  try {
    const access = await validateSubjectAccess(subjectId, studyId)
    if (!isUuid(reportId)) return Response.json({ error: 'not_found' }, { status: 404 })

    const report = await loadLabReport({ orgId: access.orgId, studyId, subjectId, reportId })

    await writeAuditLog({
      action: 'subject.view',
      orgId: access.orgId,
      studyId,
      userId: access.userId,
      resourceType: 'lab_report',
      resourceId: reportId,
      metadata: { subjectId, status: report.status },
    })

    return Response.json(
      {
        id: report.id,
        status: report.status,
        createdAt: report.createdAt.toISOString(),
        reviewedAt: report.reviewedAt?.toISOString() ?? null,
        subjectCode: access.subject.subjectCode,
        content: report.content,
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (err) {
    const known = labReportErrorResponse(err)
    if (known) return known
    if (err instanceof PhiConfigError) return new Response('Service Unavailable', { status: 503 })
    return handleApiError(err)
  }
}
