import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { confirmLabOcrReview, LabReviewError } from '../../../../../../../../lib/subjects/lab-review-service'
import { PhiConfigError } from '../../../../../../../../lib/subjects/phi-fields'
import { labOcrConfirmSchema } from '../../../../../../../../lib/subjects/schemas'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../../../lib/api/body-limit'

export const runtime = 'nodejs'

/** POST — confirma labs OCR y los persiste en profile.labs (URS-007). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params

  // Auth primero: subjectId viene de params, no del body — el acceso se
  // valida antes de leer el cuerpo (vuelta 2 del delta zod, requisito del
  // Sicario). El tope de bytes (413) corta cuerpos gigantes antes del
  // JSON.parse y del safeParse (H7).
  let access: Awaited<ReturnType<typeof validateSubjectAccess>>
  try {
    access = await validateSubjectAccess(subjectId, routeStudyId, { require: 'labs.manage' })
  } catch (err) {
    return handleApiError(err)
  }

  // POST sin labs = confirmar la revisión tal como se extrajo → body vacío
  // es válido ({}).
  let body: unknown
  try {
    body = await readJsonBody(req, { allowEmpty: true })
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) {
      return new Response('Payload Too Large', { status: 413 })
    }
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = labOcrConfirmSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, userId, study, subject } = access

    const profile = await confirmLabOcrReview({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
      labsOverride: parsed.data.labs,
      audit: (facts) => ({
        action: 'lab.confirm',
        orgId,
        studyId: study.id,
        userId,
        resourceType: 'subject',
        resourceId: subject.id,
        metadata: { labCount: facts.labCount },
      }),
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
