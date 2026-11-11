import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { NO_DESTINATION } from '@ichtys/integrations'
import { siteTimeZone } from '../../../../../../../../../lib/agenda/agenda-time'
import { writeAuditLog } from '../../../../../../../../../lib/chat/persistence'
import { isOsEnabled } from '../../../../../../../../../lib/flags'
import { exportFileName, labReportCsv } from '../../../../../../../../../lib/labs/lab-export'
import { isUuid, labReportErrorResponse } from '../../../../../../../../../lib/labs/lab-report-http'
import { loadLabReport } from '../../../../../../../../../lib/labs/lab-report-service'
import { PhiConfigError } from '../../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/**
 * GET — descarga el estudio ya revisado como CSV. No envía nada a ningún
 * sistema: es la salida para un centro sin sistema de destino conectado.
 * Solo se exporta lo que una persona revisó, y cada descarga queda registrada.
 */
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
    if (report.status !== 'confirmed') return Response.json({ error: 'not_reviewed' }, { status: 409 })

    const timeZone = siteTimeZone()
    const csv = labReportCsv({ subjectCode: access.subject.subjectCode, reviewedAt: report.reviewedAt, timeZone, rows: report.content.rows })

    // Primero el registro: un archivo con datos clínicos no sale sin dejar rastro.
    await writeAuditLog({
      action: 'lab.export',
      orgId: access.orgId,
      studyId,
      userId: access.userId,
      resourceType: 'lab_report',
      resourceId: reportId,
      metadata: { subjectId, rowCount: report.content.rows.length, format: 'csv', destination: NO_DESTINATION.id },
    })

    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${exportFileName(access.subject.subjectCode, report.reviewedAt, timeZone)}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (err) {
    const known = labReportErrorResponse(err)
    if (known) return known
    if (err instanceof PhiConfigError) return new Response('Service Unavailable', { status: 503 })
    return handleApiError(err)
  }
}
