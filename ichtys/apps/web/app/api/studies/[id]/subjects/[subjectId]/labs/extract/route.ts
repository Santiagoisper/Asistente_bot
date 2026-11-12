import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../../../lib/chat/persistence'
import { LabReviewError, proposeLabOcrReview } from '../../../../../../../../lib/subjects/lab-review-service'
import { PhiConfigError } from '../../../../../../../../lib/subjects/phi-fields'
import { labOcrExtractSchema } from '../../../../../../../../lib/subjects/schemas'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../../../lib/api/body-limit'

export const runtime = 'nodejs'

/** POST — extrae labs de texto OCR; queda en pendingLabReview (URS-007). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params

  // Auth primero: subjectId viene de params, no del body (vuelta 2 del
  // delta zod). Tope de bytes antes del parse (413, H7).
  let access: Awaited<ReturnType<typeof validateSubjectAccess>>
  try {
    access = await validateSubjectAccess(subjectId, routeStudyId, { require: 'labs.manage' })
  } catch (err) {
    return handleApiError(err)
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) {
      return new Response('Payload Too Large', { status: 413 })
    }
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = labOcrExtractSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, userId, study, subject } = access

    const result = await proposeLabOcrReview({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
      text: parsed.data.text,
    })

    await writeAuditLog({
      action: 'lab.extract',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
      metadata: {
        labCount: result.labCount,
        requiresHumanReview: true,
        piiRedactedCount: result.piiRedactedCount,
      },
    })

    return Response.json({
      subjectCode: subject.subjectCode,
      pendingLabReview: result.profile.pendingLabReview,
      labsInProfile: result.profile.labs,
    })
  } catch (err) {
    if (err instanceof LabReviewError && err.code === 'no_labs_extracted') {
      return Response.json({ error: 'no_labs_extracted' }, { status: 422 })
    }
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
