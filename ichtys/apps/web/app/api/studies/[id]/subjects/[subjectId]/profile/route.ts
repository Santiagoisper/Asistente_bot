import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../../lib/chat/persistence'
import { loadPatientProfile } from '../../../../../../../lib/subjects/patient-profile-service'
import { PhiConfigError } from '../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/** GET — perfil estructurado del sujeto (descifrado server-side). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId)

    const profile = await loadPatientProfile({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
    })

    await writeAuditLog({
      action: 'profile.view',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
    })

    return Response.json({ subjectCode: subject.subjectCode, profile })
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
