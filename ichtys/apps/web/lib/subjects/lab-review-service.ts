import {
  mergeConfirmedLabs,
  parseLabOcrText,
  type LabObservation,
  type PatientProfile,
} from '@ichtys/clinical'
import { updatePatientProfile } from './patient-profile-service'

export class LabReviewError extends Error {
  constructor(
    message: string,
    readonly code: 'no_pending_review' | 'no_labs_extracted',
  ) {
    super(message)
    this.name = 'LabReviewError'
  }
}

export async function proposeLabOcrReview(params: {
  orgId: string
  studyId: string
  subjectId: string
  text: string
}): Promise<{ profile: PatientProfile; labCount: number; piiRedactedCount: number }> {
  const parsed = parseLabOcrText(params.text)

  if (parsed.labs.length === 0) {
    throw new LabReviewError('No se detectaron analitos en el texto', 'no_labs_extracted')
  }

  const extractedAt = new Date().toISOString()
  const profile = await updatePatientProfile(params, (current) => ({
    ...current,
    pendingLabReview: {
      requiresHumanReview: true,
      extractedAt,
      labs: parsed.labs,
      redactedSourcePreview: parsed.redactedPreview,
    },
  }))

  return {
    profile,
    labCount: parsed.labs.length,
    piiRedactedCount: parsed.piiRedactedCount,
  }
}

export async function confirmLabOcrReview(params: {
  orgId: string
  studyId: string
  subjectId: string
  labsOverride?: LabObservation[]
}): Promise<PatientProfile> {
  return updatePatientProfile(params, (current) => {
    const pending = current.pendingLabReview

    if (!pending?.requiresHumanReview) {
      throw new LabReviewError('No hay revisión de labs pendiente', 'no_pending_review')
    }

    const confirmed = params.labsOverride ?? pending.labs
    const labs = mergeConfirmedLabs(current.labs, confirmed)
    const labConfidence: Record<string, 'high'> = {}
    for (const lab of confirmed) {
      labConfidence[lab.name.toLowerCase()] = 'high'
    }

    const { pendingLabReview: _removed, ...rest } = current
    const profile: PatientProfile = {
      ...rest,
      labs,
      fieldConfidence: {
        ...current.fieldConfidence,
        labs: { ...current.fieldConfidence?.labs, ...labConfidence },
      },
      lastUpdatedAt: new Date().toISOString(),
    }

    return profile
  })
}

export async function rejectLabOcrReview(params: {
  orgId: string
  studyId: string
  subjectId: string
}): Promise<PatientProfile> {
  return updatePatientProfile(params, (current) => {
    if (!current.pendingLabReview?.requiresHumanReview) {
      throw new LabReviewError('No hay revisión de labs pendiente', 'no_pending_review')
    }

    const { pendingLabReview: _removed, ...rest } = current
    const profile: PatientProfile = { ...rest, lastUpdatedAt: new Date().toISOString() }

    return profile
  })
}
