export {
  patientProfileSchema,
  emptyPatientProfile,
  parsePatientProfile,
  fieldConfidenceLevelSchema,
  type PatientProfile,
  type LabObservation,
  type Medication,
  criterionAssessmentSchema,
  type CriterionAssessment,
  type CriterionStatus,
  type FieldConfidenceLevel,
  type ProfileFieldConfidence,
  pendingLabReviewSchema,
  type PendingLabReview,
} from './profile-schema'
export { extractFactsFromEvolution, mergeProfileWithFacts, type ExtractedFacts } from './extract-facts'
export {
  parseLabOcrText,
  redactLabHeaderPii,
  mergeConfirmedLabs,
  type LabOcrParseResult,
} from './lab-ocr-parser'
export { redactPhiForLlm, type PhiRedactionResult } from './phi-redact'
export {
  mergeExtractions,
  mergeProfileWithExtraction,
  type MergedExtraction,
} from './extract-merge'
export { assessScreening, screeningSummary, type ScreeningInput } from './screening-engine'
export {
  parseAnalyteBounds,
  compareWithBounds,
  alignLabToBounds,
  describeBoundComparison,
  normalizeDecimalCommas,
  ifccMmolToNgsp,
  ngspToIfccMmol,
  formatClinicalNumber,
  textMentionsAnalyte,
  NGSP_FROM_IFCC_SLOPE,
  NGSP_FROM_IFCC_INTERCEPT,
  type AnalyteId,
  type AnalyteUnit,
  type AnalyteBounds,
  type NumericBound,
  type AlignedLab,
  type AlignLabResult,
} from './numeric-criteria'
export {
  computeVisitWindow,
  normalizeVisitWindow,
  visitWindowInputFromSpec,
  VISIT_WINDOW_VERSION,
  type VisitWindow,
  type NormalizedVisitWindow,
  type SpecVisitWindowInput,
} from './visit-window'
