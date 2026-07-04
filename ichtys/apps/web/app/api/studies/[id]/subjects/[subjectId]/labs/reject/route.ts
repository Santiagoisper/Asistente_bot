import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../../../lib/chat/persistence'
import { LabReviewError, rejectLabOcrReview } from '../../../../../../../../lib/subjects/lab-review-service'
import { PhiConfigError } from '../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/** POST — descarta revisión OCR pendiente sin persistir labs. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId)

    const profile = await rejectLabOcrReview({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
    })

    await writeAuditLog({
      action: 'lab.reject',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
    })

    return Response.json({
      subjectCode: subject.subjectCode,
      profile,
    })
  } catch (err) {
    if (err instanceof LabReviewError) {
      return Response.json({ error: err.code }, { status: 409 })
    }
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
