-- 0008_spec_amendment_tracking
-- Adds previous_approved_spec_id to study_specs for amendment detection.
-- Null = first version or no prior approved spec existed at extraction time.
-- Populated automatically by saveStudySpec() when a prior approved spec exists.
ALTER TABLE "study_specs" ADD COLUMN "previous_approved_spec_id" uuid;
