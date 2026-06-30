import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { writeAuditLog } from '../../../../../../lib/chat/persistence'

export const runtime = 'nodejs'

/**
 * GET /api/studies/[id]/subjects/[subjectId] — metadata del sujeto (sin evoluciones).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId)

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
