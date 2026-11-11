-- 0014 — Agenda del sitio: turnos por estudio y sujeto.
-- Aditiva: una tabla nueva. Las notas libres van cifradas.
CREATE TABLE IF NOT EXISTS "agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"subject_id" uuid,
	"title" text NOT NULL,
	"kind" text DEFAULT 'visit' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes_encrypted" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agenda_items_org_start_idx" ON "agenda_items" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agenda_items_subject_start_idx" ON "agenda_items" USING btree ("subject_id","starts_at");
