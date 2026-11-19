import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../lib/chat/persistence'
import { clinicalRateLimit } from '../../../../../../lib/security/clinical-rate-limit'

export const runtime = 'nodejs'

/**
 * GET /api/studies/[id]/subjects/[subjectId] — metadata del sujeto (sin evoluciones).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId, routeStudyId)
    const limited = await clinicalRateLimit('record_read', { orgId: orgId, userId: userId, studyId: study.id, req: _req, endpoint: 'subjects/[subjectId]' })
    if (limited) return limited

    await writeAuditLog({
      action: 'subject.view',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
    })

    return Response.json({
      id: subject.id,
      subjectCode: subject.subjectCode,
      status: subject.status,
      studyId: subject.studyId,
      createdAt: subject.createdAt.toISOString(),
      updatedAt: subject.updatedAt.toISOString(),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
