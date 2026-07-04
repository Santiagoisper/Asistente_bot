import {
  mergeConfirmedLabs,
  parseLabOcrText,
  type LabObservation,
  type PatientProfile,
} from '@ichtys/clinical'
import { loadPatientProfile, persistPatientProfile } from './patient-profile-service'

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
  const current = await loadPatientProfile(params)
  const parsed = parseLabOcrText(params.text)

  if (parsed.labs.length === 0) {
    throw new LabReviewError('No se detectaron analitos en el texto', 'no_labs_extracted')
  }

  const profile: PatientProfile = {
    ...current,
    pendingLabReview: {
      requiresHumanReview: true,
      extractedAt: new Date().toISOString(),
      labs: parsed.labs,
      redactedSourcePreview: parsed.redactedPreview,
    },
  }

  await persistPatientProfile({ ...params, profile })

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
  const current = await loadPatientProfile(params)
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

  await persistPatientProfile({ ...params, profile })
  return profile
}

export async function rejectLabOcrReview(params: {
  orgId: string
  studyId: string
  subjectId: string
}): Promise<PatientProfile> {
  const current = await loadPatientProfile(params)

  if (!current.pendingLabReview?.requiresHumanReview) {
    throw new LabReviewError('No hay revisión de labs pendiente', 'no_pending_review')
  }

  const { pendingLabReview: _removed, ...rest } = current
  const profile: PatientProfile = { ...rest, lastUpdatedAt: new Date().toISOString() }

  await persistPatientProfile({ ...params, profile })
  return profile
}
