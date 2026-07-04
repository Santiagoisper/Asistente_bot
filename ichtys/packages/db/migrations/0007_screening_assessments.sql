-- Migration: 0007_screening_assessments
-- Fase 2.5 — snapshots de screening determinista (sin PHI en filas).

CREATE TABLE "screening_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "study_id" uuid NOT NULL REFERENCES "studies"("id") ON DELETE CASCADE,
  "subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE CASCADE,
  "study_spec_version" integer NOT NULL,
  "profile_updated_at" timestamp with time zone NOT NULL,
  "assessments" jsonb NOT NULL,
  "summary" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "screening_assessments_subject_created_idx" ON "screening_assessments" ("subject_id", "created_at");
CREATE INDEX "screening_assessments_org_study_idx" ON "screening_assessments" ("organization_id", "study_id");
