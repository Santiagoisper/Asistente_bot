-- Migration: 0002_messages_annotations
-- Adds nullable JSONB column to store SNOMED-CT / LOINC medical annotations
-- detected in assistant answers. Null for user messages and insufficient_evidence.
ALTER TABLE "messages" ADD COLUMN "annotations" jsonb;
