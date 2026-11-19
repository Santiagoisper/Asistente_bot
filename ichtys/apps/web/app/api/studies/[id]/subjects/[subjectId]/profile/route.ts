import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../../lib/chat/persistence'
import { loadPatientProfileState } from '../../../../../../../lib/subjects/patient-profile-service'
import { PhiConfigError } from '../../../../../../../lib/subjects/phi-fields'
import { profileForResponse } from '../../../../../../../lib/subjects/profile-response'
import { clinicalRateLimit } from '../../../../../../../lib/security/clinical-rate-limit'

export const runtime = 'nodejs'

/** GET — perfil estructurado del sujeto (descifrado server-side). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId, routeStudyId)
    const limited = await clinicalRateLimit('record_read', { orgId: orgId, userId: userId, studyId: study.id, req: _req, endpoint: 'subjects/profile' })
    if (limited) return limited

    const { profile, unreadable } = await loadPatientProfileState({
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

    return Response.json({ subjectCode: subject.subjectCode, profile: profileForResponse(profile), profileUnreadable: unreadable })
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
