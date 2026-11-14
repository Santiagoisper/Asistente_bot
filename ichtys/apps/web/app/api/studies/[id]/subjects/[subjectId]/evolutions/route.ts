import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { clinicalEvolutions } from '@ichtys/db'
import { auditedWrite } from '../../../../../../../lib/audit/audited-write'
import { writeAuditLog } from '../../../../../../../lib/chat/persistence'
import {
  decryptClinicalContent,
  detectPossiblePii,
  encryptClinicalContent,
  PhiConfigError,
} from '../../../../../../../lib/subjects/phi-fields'
import { createEvolutionSchema } from '../../../../../../../lib/subjects/schemas'
import { listSubjectEvolutions } from '../../../../../../../lib/subjects/evolution-reader'
import { proposeProfileFromEvolution } from '../../../../../../../lib/subjects/patient-profile-service'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../../lib/api/body-limit'
import { getOrCreateRequestId } from '../../../../../../../lib/observability/logger'
import { clinicalRateLimit } from '../../../../../../../lib/security/clinical-rate-limit'

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

    // La historia muestra también las anuladas, con su marca: una corrección no tapa lo escrito (D24).
    const rows = await listSubjectEvolutions({ orgId, studyId: study.id, subjectId: subject.id }, 'with-voided')

    const evolutions = rows.map((row) => ({
      id: row.id,
      visitLabel: row.visitLabel,
      content: decryptClinicalContent(row.contentEncrypted),
      authorUserId: row.authorUserId,
      // Cuántas tomas tuvo el dictado (D22). Vacío si no se dictó o es anterior a la columna.
      dictationTakes: row.dictationTakes ?? null,
      // Registrada por error en este sujeto: quién no viaja a la pantalla, solo cuándo y por qué.
      voided: row.voided ? { reason: row.voided.reason, declaredAt: row.voided.declaredAt.toISOString() } : null,
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

  // Límite de pedidos: después del acceso (hace falta saber quién es) y antes de leer el cuerpo.
  const limited = await clinicalRateLimit('evolution_write', { orgId: access.orgId, userId: access.userId, studyId: access.study.id, req, endpoint: '/api/studies/[id]/subjects/[subjectId]/evolutions' })
  if (limited) return limited

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

    // D23: el dictado se confirmó para un sujeto. Si no es este, no se guarda nada: es la
    // grabación (y la evolución) en el sujeto equivocado, frenada antes de escribir.
    const { confirmedSubjectCode, ...sourceWithoutCode } = parsed.data.source ?? {}
    if (confirmedSubjectCode !== undefined && confirmedSubjectCode !== subject.subjectCode) {
      return Response.json({ error: 'subject_mismatch' }, { status: 409 })
    }
    // Al registro va el resultado de la comparación, no el código del sujeto.
    const auditSource = parsed.data.source
      ? { ...sourceWithoutCode, ...(confirmedSubjectCode !== undefined ? { subjectConfirmed: true } : {}) }
      : null

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
            // Se escribe una sola vez, acá (D22). No es contenido clínico: es un número.
            dictationTakes: parsed.data.source?.takes ?? null,
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
          // Evolución dictada: origen, modelo y revisión quedan en el registro (R6). Sin contenido.
          ...(auditSource ? { source: auditSource } : {}),
        },
      }),
    )

    // Lo que se extrae de la evolución no modifica el perfil: queda como
    // propuesta para que una persona la acepte o la descarte (R6).
    let profileProposal: 'pending' | 'none' | 'failed' = 'none'
    try {
      const { factCount } = await proposeProfileFromEvolution({
        orgId,
        studyId: study.id,
        subjectId: subject.id,
        evolutionId: evolution.id,
        evolutionContent: parsed.data.content,
        userId,
      })
      if (factCount > 0) profileProposal = 'pending'
    } catch {
      profileProposal = 'failed'
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
        profileProposal,
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
