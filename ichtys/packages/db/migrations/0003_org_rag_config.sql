-- Migration: 0003_org_rag_config
-- Adds per-org RAG tuning config (similarity threshold, topK).
-- Non-breaking: nullable column, system defaults apply when NULL.
ALTER TABLE "organizations" ADD COLUMN "rag_config" jsonb;
