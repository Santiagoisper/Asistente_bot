-- 0018 — Grabación de la evolución dictada (docs/decisions/consulta-dictada.md, D14).
-- Aditiva: una tabla nueva. El audio va cifrado y se borra al vencer; la fila queda.
CREATE TABLE IF NOT EXISTS "dictation_audios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"evolution_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_sec" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_encrypted" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dictation_audios" ADD CONSTRAINT "dictation_audios_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dictation_audios" ADD CONSTRAINT "dictation_audios_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dictation_audios" ADD CONSTRAINT "dictation_audios_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dictation_audios" ADD CONSTRAINT "dictation_audios_evolution_id_fk" FOREIGN KEY ("evolution_id") REFERENCES "clinical_evolutions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dictation_audios_evolution_uniq" ON "dictation_audios" USING btree ("evolution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dictation_audios_org_subject_idx" ON "dictation_audios" USING btree ("organization_id","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dictation_audios_expires_idx" ON "dictation_audios" USING btree ("expires_at");
