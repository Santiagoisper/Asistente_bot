export {
  patientProfileSchema,
  emptyPatientProfile,
  parsePatientProfile,
  labObservationSchema,
  labSourceSchema,
  type LabSource,
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
  pendingProfileProposalSchema,
  type PendingLabReview,
  type PendingProfileProposal,
} from './profile-schema'
export { extractFactsFromEvolution, mergeProfileWithFacts, type ExtractedFacts } from './extract-facts'
export {
  parseLabOcrText,
  redactLabHeaderPii,
  mergeConfirmedLabs,
  type LabOcrParseResult,
} from './lab-ocr-parser'
export { labFromEvolution, labsFromLabReport, labsFromPastedText } from './lab-source'
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
  compatWindowDays,
  VISIT_WINDOW_VERSION,
  type VisitWindow,
  type NormalizedVisitWindow,
  type SpecVisitWindowInput,
} from './visit-window'
export {
  MAX_LAB_REPORT_LINES,
  MAX_LAB_REPORT_ROWS,
  normalizeAnalyteKey,
  numericReadings,
  parseLabReportText,
  parsePrintedNumber,
  redactIdentifyingLines,
  rowIsGrounded,
  type ParsedLabReport,
  type ParsedLabRow,
} from './lab-report-parser'
export {
  containsPrintedValue,
  groundReaderRows,
  mergeImageReadings,
  mergeTextReadings,
  type ImageReading,
  type MergedImageReadings,
  type MergedLabRow,
  type MergedTextReadings,
  type ReaderRow,
} from './lab-readings'
export * from './dictation'
