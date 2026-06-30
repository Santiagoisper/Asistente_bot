import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { and, clinicalEvolutions, db, desc, eq } from '@ichtys/db'
import { writeAuditLog } from '../../../../../../../lib/chat/persistence'
import {
  decryptClinicalContent,
  detectPossiblePii,
  encryptClinicalContent,
  PhiConfigError,
} from '../../../../../../../lib/subjects/phi-fields'
import { createEvolutionSchema } from '../../../../../../../lib/subjects/schemas'
import { refreshPatientProfileFromEvolution } from '../../../../../../../lib/subjects/patient-profile-service'

export const runtime = 'nodejs'

/**
 * GET — evoluciones del sujeto (contenido descifrado server-side).
 * POST — nueva evolución clínica cifrada at-rest.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId)

    const rows = await db.query.clinicalEvolutions.findMany({
      where: and(
        eq(clinicalEvolutions.subjectId, subject.id),
        eq(clinicalEvolutions.organizationId, orgId),
        eq(clinicalEvolutions.studyId, study.id),
      ),
      orderBy: [desc(clinicalEvolutions.createdAt)],
    })

    const evolutions = rows.map((row) => ({
      id: row.id,
      visitLabel: row.visitLabel,
      content: decryptClinicalContent(row.contentEncrypted),
      authorUserId: row.authorUserId,
      createdAt: row.createdAt.toISOString(),
    }))

    await writeAuditLog({
      action: 'evolution.view',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
      metadata: { count: evolutions.length },
    })

    return Response.json({ subjectCode: subject.subjectCode, evolutions })
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { subjectId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = createEvolutionSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId)

    const piiWarnings = detectPossiblePii(parsed.data.content)
    const contentEncrypted = encryptClinicalContent(parsed.data.content)

    const [evolution] = await db
      .insert(clinicalEvolutions)
      .values({
        organizationId: orgId,
        studyId: study.id,
        subjectId: subject.id,
        authorUserId: userId,
        visitLabel: parsed.data.visitLabel?.trim() || null,
        contentEncrypted,
      })
      .returning()

    if (!evolution) {
      return new Response('Internal Server Error', { status: 500 })
    }

    await writeAuditLog({
      action: 'evolution.create',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'clinical_evolution',
      resourceId: evolution.id,
      metadata: {
        subjectId: subject.id,
        contentLength: parsed.data.content.length,
        piiWarningCount: piiWarnings.length,
      },
    })

    let profileUpdated = false
    try {
      await refreshPatientProfileFromEvolution({
        orgId,
        studyId: study.id,
        subjectId: subject.id,
        evolutionId: evolution.id,
        evolutionContent: parsed.data.content,
      })
      profileUpdated = true
    } catch (profileErr) {
      console.error('[evolution.create] profile refresh failed:', profileErr)
    }

    return Response.json(
      {
        id: evolution.id,
        visitLabel: evolution.visitLabel,
        content: parsed.data.content,
        piiWarnings,
        profileUpdated,
        createdAt: evolution.createdAt.toISOString(),
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
