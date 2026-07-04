import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../../../lib/chat/persistence'
import { confirmLabOcrReview, LabReviewError } from '../../../../../../../../lib/subjects/lab-review-service'
import { PhiConfigError } from '../../../../../../../../lib/subjects/phi-fields'
import { labOcrConfirmSchema } from '../../../../../../../../lib/subjects/schemas'

export const runtime = 'nodejs'

/** POST — confirma labs OCR y los persiste en profile.labs (URS-007). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { subjectId } = await params

  let body: unknown = {}
  try {
    const raw = await req.text()
    if (raw.trim()) body = JSON.parse(raw)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = labOcrConfirmSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId)

    const profile = await confirmLabOcrReview({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
      labsOverride: parsed.data.labs,
    })

    await writeAuditLog({
      action: 'lab.confirm',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
      metadata: { labCount: profile.labs.length },
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
