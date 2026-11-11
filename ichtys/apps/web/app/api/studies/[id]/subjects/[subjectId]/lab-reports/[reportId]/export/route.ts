import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { NO_DESTINATION } from '@ichtys/integrations'
import { siteTimeZone } from '../../../../../../../../../lib/agenda/agenda-time'
import { writeAuditLog } from '../../../../../../../../../lib/chat/persistence'
import { isOsEnabled } from '../../../../../../../../../lib/flags'
import { exportFileName, labReportCsv, labRowsForClipboard } from '../../../../../../../../../lib/labs/lab-export'
import { isUuid, labReportErrorResponse } from '../../../../../../../../../lib/labs/lab-report-http'
import { loadLabReport } from '../../../../../../../../../lib/labs/lab-report-service'
import { PhiConfigError } from '../../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

const FORMATS = { csv: 'csv', texto: 'clipboard' } as const

/**
 * GET — saca un estudio ya revisado: como CSV para descargar, o como texto
 * (`?formato=texto`) para copiar y pegar en otra pantalla. No envía nada a
 * ningún sistema: es la salida para un centro sin sistema de destino conectado.
 * Solo sale lo que una persona revisó, y cada salida queda registrada.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string; reportId: string }> },
): Promise<Response> {
  const { id: studyId, subjectId, reportId } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  try {
    const access = await validateSubjectAccess(subjectId, studyId)
    if (!isUuid(reportId)) return Response.json({ error: 'not_found' }, { status: 404 })
    const requested = new URL(req.url).searchParams.get('formato') ?? 'csv'
    if (!Object.hasOwn(FORMATS, requested)) return Response.json({ error: 'invalid_format' }, { status: 400 })
    const format = FORMATS[requested as keyof typeof FORMATS]

    const report = await loadLabReport({ orgId: access.orgId, studyId, subjectId, reportId })
    if (report.status !== 'confirmed') return Response.json({ error: 'not_reviewed' }, { status: 409 })

    const context = {
      studyLabel: access.study.protocolNumber?.trim() || access.study.name,
      subjectCode: access.subject.subjectCode,
      reportId,
      reviewedAt: report.reviewedAt,
      timeZone: siteTimeZone(),
    }
    const body = format === 'csv' ? labReportCsv({ ...context, rows: report.content.rows }) : labRowsForClipboard(report.content.rows)

    // Primero el registro: datos clínicos no salen sin dejar rastro.
    await writeAuditLog({
      action: 'lab.export',
      orgId: access.orgId,
      studyId,
      userId: access.userId,
      resourceType: 'lab_report',
      resourceId: reportId,
      metadata: { subjectId, rowCount: report.content.rows.length, format, destination: NO_DESTINATION.id },
    })

    const headers: Record<string, string> = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
    if (format === 'csv') {
      headers['content-type'] = 'text/csv; charset=utf-8'
      headers['content-disposition'] = `attachment; filename="${exportFileName(context)}"`
    } else {
      headers['content-type'] = 'text/plain; charset=utf-8'
    }
    return new Response(body, { headers })
  } catch (err) {
    const known = labReportErrorResponse(err)
    if (known) return known
    if (err instanceof PhiConfigError) return new Response('Service Unavailable', { status: 503 })
    return handleApiError(err)
  }
}
