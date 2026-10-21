-- 0009_usage_metering
-- Medición de consumo de tokens por organización y cupo mensual del plan (modelo híbrido:
-- cuota mensual con cupo incluido + clave propia opcional del cliente).
--
-- Solo agrega objetos nuevos (no modifica ni borra datos existentes) y es idempotente.
-- Aplicar ANTES de desplegar código que use estas tablas (ver docs/OPERATIONS.md §9).

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "plan_name" text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "monthly_token_quota" bigint;

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "study_id" uuid,
  "user_id" text,
  "kind" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "key_source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "usage_events_org_created_idx"
  ON "usage_events" USING btree ("organization_id", "created_at" DESC);
