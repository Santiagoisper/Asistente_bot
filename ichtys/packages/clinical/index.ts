export {
  patientProfileSchema,
  emptyPatientProfile,
  parsePatientProfile,
  type PatientProfile,
  type CriterionAssessment,
  type CriterionStatus,
} from './profile-schema'
export { extractFactsFromEvolution, mergeProfileWithFacts, type ExtractedFacts } from './extract-facts'
export { assessScreening, screeningSummary, type ScreeningInput } from './screening-engine'
