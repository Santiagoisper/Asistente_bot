import type { PatientProfile } from '@ichtys/clinical'
import { updatePatientProfile } from './patient-profile-service'
import { retireFromVoidedEvolution, type RetiredCounts } from './voided-origin-retire'

/**
 * Una persona retira del perfil lo que entró desde una evolución anulada (D24, 4 bis).
 * La escritura del perfil y su registro van en la misma transacción (R3). El registro lleva
 * cantidades y la evolución; nunca nombres ni valores: lo retirado queda dentro del perfil cifrado.
 *
 * Quien llama ya comprobó que la persona puede escribir el perfil y que la evolución está anulada.
 */
export async function retireVoidedOriginFacts(params: {
  orgId: string
  studyId: string
  subjectId: string
  evolutionId: string
  userId: string
  removeAge?: boolean
  removeBloodPressure?: boolean
  medications?: readonly string[]
  conditions?: readonly string[]
  nothingToRetire?: boolean
}): Promise<{ profile: PatientProfile; removed: RetiredCounts }> {
  // Una sola fecha aunque la escritura se reintente porque otra persona escribió en el medio.
  const at = new Date()
  let removed: RetiredCounts = { labs: 0, medications: 0, conditions: 0, age: false, bloodPressure: false }
  const profile = await updatePatientProfile(
    params,
    (current) => {
      const result = retireFromVoidedEvolution(current, {
        evolutionId: params.evolutionId,
        by: params.userId,
        at,
        removeAge: params.removeAge,
        removeBloodPressure: params.removeBloodPressure,
        medications: params.medications,
        conditions: params.conditions,
        nothingToRetire: params.nothingToRetire,
      })
      removed = result.removed
      return result.profile
    },
    () => ({
      action: 'profile.update',
      orgId: params.orgId,
      studyId: params.studyId,
      userId: params.userId,
      resourceType: 'subject',
      resourceId: params.subjectId,
      metadata: {
        source: 'voided_origin_retire',
        evolutionId: params.evolutionId,
        humanConfirmed: true,
        ...removed,
        // Una revisión declarada vacía se puede contar aparte: quién, cuándo y de qué evolución.
        ...(params.nothingToRetire === true ? { nothingToRetire: true } : {}),
      },
    }),
  )
  return { profile, removed }
}
