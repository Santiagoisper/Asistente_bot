import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { studySpecSchema } from '@ichtys/ingestion/study-spec'
import { getLatestSpecAttempt, getLatestStudySpec } from '@ichtys/ingestion/spec-store'
import { loadPatientProfileState } from '../../../../../../../lib/subjects/patient-profile-service'
import { evaluateAndPersistScreening } from '../../../../../../../lib/subjects/screening-service'
import { PhiConfigError } from '../../../../../../../lib/subjects/phi-fields'
import { guideVisits } from '../../../../../../../lib/subjects/guide-visits'
import { profileForResponse } from '../../../../../../../lib/subjects/profile-response'
import { pendingSpecApproval, SPEC_PENDING_APPROVAL_MESSAGE } from '../../../../../../../lib/subjects/spec-notice'

export const runtime = 'nodejs'

type SpecRow = NonNullable<Awaited<ReturnType<typeof getLatestSpecAttempt>>>

/** El último intento, si es una extracción que alguien puede revisar: no un fallo ni algo ilegible. */
function usableAttempt(row: SpecRow | null | undefined): SpecRow | null {
  if (!row) return null
  const parsed = studySpecSchema.safeParse(row.spec)
  return parsed.success && !parsed.data.extractionFailed ? row : null
}

/** El cronograma del último borrador útil, para la guía de dictado. `null` si no hay un borrador que leer. */
async function draftGuideVisits(scope: { orgId: string; studyId: string }) {
  const row = await getLatestStudySpec({ ...scope, approvedOnly: false })
  if (!row || row.status !== 'draft') return null
  const parsed = studySpecSchema.safeParse(row.spec)
  return parsed.success ? guideVisits(parsed.data) : null
}

/** GET — screening determinista vs spec del protocolo (Fase 2.5). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId, routeStudyId)

    const { profile, unreadable: profileUnreadable } = await loadPatientProfileState({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
    })

    // C5: la elegibilidad solo se evalúa contra un protocolo extraído que una persona aprobó.
    // Un borrador no se evalúa, no deja instantánea y tampoco aporta el cronograma de visitas.
    const specRow = await getLatestStudySpec({ orgId, studyId: study.id, approvedOnly: true })
    // Para el aviso se mira el último intento, no «el último útil»: un borrador nuevo que solo
    // trae la identificación también espera aprobación. Una extracción fallida no espera nada.
    const pending = pendingSpecApproval(specRow, usableAttempt(await getLatestSpecAttempt({ orgId, studyId: study.id })))
    if (!specRow) {
      // Decisión de Santiago del 12/11/2026: la guía de dictado aparece con el protocolo en
      // borrador, y lo avisa. El cronograma del borrador sale solo para eso, marcado; la
      // evaluación no se hace.
      const draftVisits = pending.pending ? await draftGuideVisits({ orgId, studyId: study.id }) : null
      return Response.json({
        subjectCode: subject.subjectCode,
        profile: profileForResponse(profile),
        assessments: [],
        summary: { pass: 0, fail: 0, unknown: 0 },
        specAvailable: false,
        profileUnreadable,
        protocolDocumentId: null,
        specPendingApproval: pending.pending,
        pendingSpecVersion: pending.version,
        ...(draftVisits ? { visits: draftVisits, visitsFromDraft: true } : {}),
        message: pending.pending ? SPEC_PENDING_APPROVAL_MESSAGE : 'No hay study spec extraído para este estudio.',
      })
    }

    const parsedSpec = studySpecSchema.safeParse(specRow.spec)
    if (!parsedSpec.success) {
      return Response.json({
        subjectCode: subject.subjectCode,
        profile: profileForResponse(profile),
        assessments: [],
        summary: { pass: 0, fail: 0, unknown: 0 },
        specAvailable: false,
        profileUnreadable,
        protocolDocumentId: null,
        message: 'El study spec no es válido.',
      })
    }

    // Un perfil que no se pudo leer llega acá vacío. Evaluarlo daría todo «a revisar» y
    // dejaría guardada esa evaluación como si fuera la del sujeto: no se evalúa ni se guarda.
    if (profileUnreadable) {
      return Response.json({
        subjectCode: subject.subjectCode,
        profile: profileForResponse(profile),
        assessments: [],
        summary: { pass: 0, fail: 0, unknown: 0 },
        specAvailable: true,
        profileUnreadable: true,
        specVersion: specRow.version,
        specStatus: specRow.status,
        // El estado del perfil no cambia qué protocolo espera aprobación.
        specPendingApproval: pending.pending,
        pendingSpecVersion: pending.version,
        protocolDocumentId: null,
        visits: guideVisits(parsedSpec.data),
      })
    }

    const evaluation = await evaluateAndPersistScreening({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
      // La evaluación recibe el perfil entero; lo que sale a la pantalla, no.
      profile,
      spec: parsedSpec.data,
      specVersion: specRow.version,
      documentVersionId: specRow.documentVersionId,
      // El registro lo escribe el servicio: junto con la instantánea si guarda una, o como lectura si no.
      audit: (facts) => ({
        action: 'screening.view',
        orgId,
        studyId: study.id,
        userId,
        resourceType: 'subject',
        resourceId: subject.id,
        metadata: {
          pass: facts.summary.pass,
          fail: facts.summary.fail,
          unknown: facts.summary.unknown,
          snapshotId: facts.snapshotId,
          snapshotCreated: facts.snapshotCreated,
        },
      }),
    })

    return Response.json({
      subjectCode: subject.subjectCode,
      profile: profileForResponse(profile),
      assessments: evaluation.assessments,
      summary: evaluation.summary,
      specAvailable: true,
      profileUnreadable: false,
      specVersion: evaluation.specVersion,
      specStatus: specRow.status,
      // Hay una versión más nueva sin aprobar: la evaluación sigue saliendo de la aprobada, y se dice.
      specPendingApproval: pending.pending,
      pendingSpecVersion: pending.version,
      protocolDocumentId: evaluation.protocolDocumentId,
      // El cronograma del protocolo, para que la guía muestre los procedimientos de la visita (D21).
      visits: guideVisits(parsedSpec.data),
    })
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
