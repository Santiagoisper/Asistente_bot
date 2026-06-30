-- Migration: 0006_subjects_clinical_module
-- Fase 1 — sujetos pseudonimizados, evoluciones clínicas cifradas, perfiles de paciente.

CREATE TABLE "subjects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "study_id" uuid NOT NULL REFERENCES "studies"("id") ON DELETE CASCADE,
  "subject_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'screening',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "subjects_org_study_code_idx" ON "subjects" ("organization_id", "study_id", "subject_code");
CREATE INDEX "subjects_org_study_idx" ON "subjects" ("organization_id", "study_id");

CREATE TABLE "clinical_evolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "study_id" uuid NOT NULL REFERENCES "studies"("id") ON DELETE CASCADE,
  "subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE CASCADE,
  "author_user_id" text NOT NULL,
  "visit_label" text,
  "content_encrypted" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "clinical_evolutions_subject_created_idx" ON "clinical_evolutions" ("subject_id", "created_at");
CREATE INDEX "clinical_evolutions_org_study_idx" ON "clinical_evolutions" ("organization_id", "study_id");

CREATE TABLE "patient_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "study_id" uuid NOT NULL REFERENCES "studies"("id") ON DELETE CASCADE,
  "subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE CASCADE,
  "profile_encrypted" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "patient_profiles_subject_idx" ON "patient_profiles" ("subject_id");
