-- 0012 — Carga de laboratorios: catálogo de analitos e informes subidos.
-- Aditiva: dos tablas nuevas. Los valores clínicos van cifrados en
-- lab_reports.content_encrypted; lab_analytes no guarda datos de pacientes.
CREATE TABLE IF NOT EXISTS "lab_analytes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_key" text NOT NULL,
	"unit" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lab_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"source_kind" text NOT NULL,
	"content_encrypted" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_analytes" ADD CONSTRAINT "lab_analytes_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lab_analytes_org_key_idx" ON "lab_analytes" USING btree ("organization_id","normalized_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_reports_org_status_idx" ON "lab_reports" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_reports_subject_idx" ON "lab_reports" USING btree ("subject_id","created_at");
