import { validatePhiStudyAccess, handleApiError } from '@ichtys/auth'
import {
  and,
  db,
  desc,
  eq,
  patientProfiles,
  subjects,
} from '@ichtys/db'
import { auditedWrite } from '../../../../../lib/audit/audited-write'
import { writeAuditLog } from '../../../../../lib/chat/persistence'
import {
  encryptProfileJson,
  PhiConfigError,
} from '../../../../../lib/subjects/phi-fields'
import { createSubjectSchema } from '../../../../../lib/subjects/schemas'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../lib/api/body-limit'

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

  // Auth primero: studyId viene de params, no del body (vuelta 2 del delta
  // zod). Tope de bytes antes del parse (413, H7).
  let access: Awaited<ReturnType<typeof validatePhiStudyAccess>>
  try {
    access = await validatePhiStudyAccess(studyId, { require: 'subjects.manage' })
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

  const parsed = createSubjectSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, userId, study } = access

    const subjectCode = parsed.data.subjectCode.trim().toUpperCase()

    const emptyProfile = encryptProfileJson({})

    // El sujeto, su perfil vacío y el registro de auditoría se confirman en la
    // misma transacción (R3). Antes eran tres escrituras sueltas: podía quedar
    // un sujeto sin perfil, o un sujeto sin registro de quién lo dio de alta.
    const subject = await auditedWrite(
      async (tx) => {
        const [created] = await tx
          .insert(subjects)
          .values({
            organizationId: orgId,
            studyId: study.id,
            subjectCode,
            status: 'screening',
          })
          .returning()
        if (!created) throw new Error('Subject insert did not return a row')

        await tx.insert(patientProfiles).values({
          organizationId: orgId,
          studyId: study.id,
          subjectId: created.id,
          profileEncrypted: emptyProfile,
        })
        return created
      },
      (created) => ({
        action: 'subject.create',
        orgId,
        studyId: study.id,
        userId,
        resourceType: 'subject',
        resourceId: created.id,
        metadata: { subjectCode },
      }),
    )

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

/**
 * Código repetido dentro del estudio (violación de índice único en Postgres).
 * El acceso a datos envuelve el error de la base y deja el original en `cause`,
 * así que se mira también ahí; si no, el aviso de código repetido nunca llega
 * a quien carga y ve un error genérico.
 */
function isUniqueViolation(err: unknown): boolean {
  for (let current: unknown = err, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== 'object') return false
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
