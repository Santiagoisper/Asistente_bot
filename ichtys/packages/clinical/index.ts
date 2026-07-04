export {
  patientProfileSchema,
  emptyPatientProfile,
  parsePatientProfile,
  fieldConfidenceLevelSchema,
  type PatientProfile,
  criterionAssessmentSchema,
  type CriterionAssessment,
  type CriterionStatus,
  type FieldConfidenceLevel,
  type ProfileFieldConfidence,
} from './profile-schema'
export { extractFactsFromEvolution, mergeProfileWithFacts, type ExtractedFacts } from './extract-facts'
export { redactPhiForLlm, type PhiRedactionResult } from './phi-redact'
export {
  mergeExtractions,
  mergeProfileWithExtraction,
  type MergedExtraction,
} from './extract-merge'
export { assessScreening, screeningSummary, type ScreeningInput } from './screening-engine'
