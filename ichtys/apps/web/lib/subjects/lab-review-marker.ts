import type { PatientProfile } from '@ichtys/clinical'

export interface LabReviewMarker {
  labReviewPending: boolean
  labReviewPendingSince: Date | null
}

/**
 * Marca operativa (no clínica) que acompaña al perfil cifrado: dice si hay una
 * revisión de laboratorio esperando confirmación humana y desde cuándo.
 * Se deriva del perfil en cada escritura, así nunca queda desfasada de él y el
 * Inicio puede contar pendientes sin descifrar PHI.
 */
export function labReviewMarker(profile: PatientProfile): LabReviewMarker {
  const pending = profile.pendingLabReview
  if (!pending?.requiresHumanReview) {
    return { labReviewPending: false, labReviewPendingSince: null }
  }
  const since = new Date(pending.extractedAt)
  return {
    labReviewPending: true,
    labReviewPendingSince: Number.isNaN(since.getTime()) ? null : since,
  }
}
