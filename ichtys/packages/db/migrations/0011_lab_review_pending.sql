-- 0011 — Marca operativa de revisión de laboratorio pendiente.
-- No es dato clínico: permite contar pendientes sin descifrar profile_encrypted.
-- Después de aplicar: correr scripts/backfill-lab-review-pending.ts --apply
-- (las filas existentes quedan en false hasta el backfill).
ALTER TABLE "patient_profiles" ADD COLUMN IF NOT EXISTS "lab_review_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_profiles" ADD COLUMN IF NOT EXISTS "lab_review_pending_since" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_profiles_lab_review_pending_idx" ON "patient_profiles" USING btree ("organization_id") WHERE "patient_profiles"."lab_review_pending" = true;
