import { notFound } from 'next/navigation'
import { validateSubjectAccess } from '@ichtys/auth'
import { LabReviewClient } from '../../../../../../../../components/labs/review-client'
import { writeAuditLog } from '../../../../../../../../lib/chat/persistence'
import { isOsEnabled } from '../../../../../../../../lib/flags'
import { isUuid } from '../../../../../../../../lib/labs/lab-report-http'
import { LabReportError, loadLabReport, type LoadedLabReport } from '../../../../../../../../lib/labs/lab-report-service'

export const dynamic = 'force-dynamic'

export default async function LabReportReviewPage({
  params,
}: {
  params: Promise<{ id: string; subjectId: string; reportId: string }>
}) {
  const { id: studyId, subjectId, reportId } = await params
  if (!isOsEnabled() || !isUuid(reportId)) notFound()

  // Organización, estudio, sujeto y permiso de datos de sujetos, todo desde el token.
  let access: Awaited<ReturnType<typeof validateSubjectAccess>>
  try {
    access = await validateSubjectAccess(subjectId, studyId)
  } catch {
    notFound()
  }

  let report: LoadedLabReport
  try {
    report = await loadLabReport({ orgId: access.orgId, studyId, subjectId, reportId })
  } catch (err) {
    if (err instanceof LabReportError) notFound()
    throw err
  }

  await writeAuditLog({
    action: 'subject.view',
    orgId: access.orgId,
    studyId,
    userId: access.userId,
    resourceType: 'lab_report',
    resourceId: reportId,
    metadata: { subjectId, status: report.status },
  })

  return (
    <LabReviewClient
      studyId={studyId}
      subjectId={subjectId}
      reportId={reportId}
      subjectCode={access.subject.subjectCode}
      studyLabel={access.study.protocolNumber?.trim() || access.study.name}
      status={report.status}
      content={report.content}
    />
  )
}
