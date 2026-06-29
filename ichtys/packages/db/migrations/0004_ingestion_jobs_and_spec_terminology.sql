-- Migration: 0004_ingestion_jobs_and_spec_terminology
-- Adds ingestion_jobs table for bulk import queue and terminology_annotations
-- column on study_specs (SNOMED/LOINC pre-computed on spec approval).

ALTER TABLE "study_specs" ADD COLUMN "terminology_annotations" jsonb;

CREATE TABLE "ingestion_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "batch_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "file_name" text NOT NULL,
  "study_id" uuid REFERENCES "studies"("id") ON DELETE SET NULL,
  "document_id" uuid REFERENCES "documents"("id") ON DELETE SET NULL,
  "document_version_id" uuid REFERENCES "document_versions"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "error_message" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);

CREATE INDEX "ingestion_jobs_org_batch_idx" ON "ingestion_jobs" ("organization_id", "batch_id");
CREATE INDEX "ingestion_jobs_status_idx" ON "ingestion_jobs" ("status");
