-- 0013 — Carga de laboratorios, fotos y escaneos: imagen recortada del informe.
-- Aditiva: una tabla nueva. La imagen va cifrada y se borra cuando el informe
-- se confirma o se rechaza.
CREATE TABLE IF NOT EXISTS "lab_report_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"mime" text NOT NULL,
	"content_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_report_images" ADD CONSTRAINT "lab_report_images_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_report_images" ADD CONSTRAINT "lab_report_images_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_report_images" ADD CONSTRAINT "lab_report_images_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "lab_reports"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lab_report_images_report_page_idx" ON "lab_report_images" USING btree ("report_id","page");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_report_images_org_idx" ON "lab_report_images" USING btree ("organization_id");
