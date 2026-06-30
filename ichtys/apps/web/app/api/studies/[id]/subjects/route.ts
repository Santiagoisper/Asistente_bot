import { validatePhiStudyAccess, handleApiError } from '@ichtys/auth'
import {
  and,
  db,
  desc,
  eq,
  patientProfiles,
  subjects,
} from '@ichtys/db'
import { writeAuditLog } from '../../../../../lib/chat/persistence'
import {
  encryptProfileJson,
  PhiConfigError,
} from '../../../../../lib/subjects/phi-fields'
import { createSubjectSchema } from '../../../../../lib/subjects/schemas'

export const runtime = 'nodejs'

/**
 * GET /api/studies/[id]/subjects — lista sujetos del estudio (sin PHI).
 * POST — crea sujeto pseudonimizado + perfil vacío cifrado.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: studyId } = await params

  try {
    const { orgId, userId } = await validatePhiStudyAccess(studyId)

    const rows = await db.query.subjects.findMany({
      where: and(eq(subjects.organizationId, orgId), eq(subjects.studyId, studyId)),
      orderBy: [desc(subjects.createdAt)],
    })

    await writeAuditLog({
      action: 'subject.view',
      orgId,
      studyId,
      userId,
      resourceType: 'study',
      resourceId: studyId,
      metadata: { count: rows.length },
    })

    return Response.json(
      rows.map((s) => ({
        id: s.id,
        subjectCode: s.subjectCode,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    )
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: studyId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = createSubjectSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, userId, study } = await validatePhiStudyAccess(studyId)

    const subjectCode = parsed.data.subjectCode.trim().toUpperCase()

    const [subject] = await db
      .insert(subjects)
      .values({
        organizationId: orgId,
        studyId: study.id,
        subjectCode,
        status: 'screening',
      })
      .returning()

    if (!subject) {
      return new Response('Internal Server Error', { status: 500 })
    }

    const emptyProfile = encryptProfileJson({})

    await db.insert(patientProfiles).values({
      organizationId: orgId,
      studyId: study.id,
      subjectId: subject.id,
      profileEncrypted: emptyProfile,
    })

    await writeAuditLog({
      action: 'subject.create',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
      metadata: { subjectCode },
    })

    return Response.json(
      {
        id: subject.id,
        subjectCode: subject.subjectCode,
        status: subject.status,
        createdAt: subject.createdAt.toISOString(),
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    if (isUniqueViolation(err)) {
      return Response.json({ error: 'subject_code_exists' }, { status: 409 })
    }
    return handleApiError(err)
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  )
}
