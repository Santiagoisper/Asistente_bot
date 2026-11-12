import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { and, clinicalEvolutions, db, desc, eq } from '@ichtys/db'
import { auditedWrite } from '../../../../../../../lib/audit/audited-write'
import { writeAuditLog } from '../../../../../../../lib/chat/persistence'
import {
  decryptClinicalContent,
  detectPossiblePii,
  encryptClinicalContent,
  PhiConfigError,
} from '../../../../../../../lib/subjects/phi-fields'
import { createEvolutionSchema } from '../../../../../../../lib/subjects/schemas'
import { refreshPatientProfileFromEvolution } from '../../../../../../../lib/subjects/patient-profile-service'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../../lib/api/body-limit'
import { getOrCreateRequestId } from '../../../../../../../lib/observability/logger'

export const runtime = 'nodejs'

/**
 * GET — evoluciones del sujeto (contenido descifrado server-side).
 * POST — nueva evolución clínica cifrada at-rest.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId, routeStudyId)

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
  const requestId = getOrCreateRequestId(req)
  const { id: routeStudyId, subjectId } = await params

  // Auth primero: subjectId viene de params, no del body (vuelta 2 del
  // delta zod). Tope de bytes antes del parse (413, H7).
  let access: Awaited<ReturnType<typeof validateSubjectAccess>>
  try {
    access = await validateSubjectAccess(subjectId, routeStudyId, { require: 'clinical.author' })
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

  const parsed = createEvolutionSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, userId, study, subject } = access

    const piiWarnings = detectPossiblePii(parsed.data.content)
    const contentEncrypted = encryptClinicalContent(parsed.data.content)

    // La evolución y su registro de auditoría se confirman en la misma
    // transacción (R3): si el registro falla, la evolución no queda guardada.
    const evolution = await auditedWrite(
      async (tx) => {
        const [created] = await tx
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
        if (!created) throw new Error('Evolution insert did not return a row')
        return created
      },
      (created) => ({
        action: 'evolution.create',
        orgId,
        studyId: study.id,
        userId,
        resourceType: 'clinical_evolution',
        resourceId: created.id,
        metadata: {
          subjectId: subject.id,
          contentLength: parsed.data.content.length,
          piiWarningCount: piiWarnings.length,
        },
      }),
    )

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
    } catch {
      // El error crudo puede traer mensaje, stack y campos de dependencias.
      // Solo código estable, id de la solicitud y los ids que ya tenemos.
      console.error('[evolution.create] profile_refresh_failed', {
        code: 'profile_refresh_failed',
        requestId,
        studyId: study.id,
        subjectId: subject.id,
      })
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
