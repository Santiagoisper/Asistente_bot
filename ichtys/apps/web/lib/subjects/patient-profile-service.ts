import {
  extractFactsFromEvolution,
  mergeProfileWithFacts,
  parsePatientProfile,
  type PatientProfile,
} from '@ichtys/clinical'
import { and, db, eq, patientProfiles } from '@ichtys/db'
import { decryptProfileJson, encryptProfileJson } from './phi-fields'

export async function loadPatientProfile(params: {
  orgId: string
  studyId: string
  subjectId: string
}): Promise<PatientProfile> {
  const row = await db.query.patientProfiles.findFirst({
    where: and(
      eq(patientProfiles.organizationId, params.orgId),
      eq(patientProfiles.studyId, params.studyId),
      eq(patientProfiles.subjectId, params.subjectId),
    ),
  })

  if (!row) return parsePatientProfile({})
  return parsePatientProfile(decryptProfileJson(row.profileEncrypted))
}

export async function refreshPatientProfileFromEvolution(params: {
  orgId: string
  studyId: string
  subjectId: string
  evolutionId: string
  evolutionContent: string
}): Promise<PatientProfile> {
  const current = await loadPatientProfile(params)
  const facts = extractFactsFromEvolution(params.evolutionContent, params.evolutionId)
  const merged = mergeProfileWithFacts(current, facts, params.evolutionId)
  const profileEncrypted = encryptProfileJson(merged)

  await db
    .update(patientProfiles)
    .set({ profileEncrypted, updatedAt: new Date() })
    .where(
      and(
        eq(patientProfiles.organizationId, params.orgId),
        eq(patientProfiles.studyId, params.studyId),
        eq(patientProfiles.subjectId, params.subjectId),
      ),
    )

  return merged
}
