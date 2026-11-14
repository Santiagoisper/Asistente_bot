-- 0021 — Evolución registrada en el sujeto equivocado (docs/decisions/grabacion-en-sujeto-equivocado.md, D24).
-- Aditiva: dos tablas nuevas y una columna opcional en la de grabaciones.
--
-- Primera tabla: las anulaciones. La evolución no se modifica ni se borra: que está anulada se
-- sabe porque existe una fila acá, con quién lo declaró, cuándo y por qué. Una por evolución.
CREATE TABLE IF NOT EXISTS "evolution_voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"evolution_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note_encrypted" text,
	"declared_by" text NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_voids" ADD CONSTRAINT "evolution_voids_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_voids" ADD CONSTRAINT "evolution_voids_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_voids" ADD CONSTRAINT "evolution_voids_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_voids" ADD CONSTRAINT "evolution_voids_evolution_id_fk" FOREIGN KEY ("evolution_id") REFERENCES "clinical_evolutions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evolution_voids_evolution_uniq" ON "evolution_voids" USING btree ("evolution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_voids_org_subject_idx" ON "evolution_voids" USING btree ("organization_id","subject_id");--> statement-breakpoint
-- Segunda tabla: el depósito de grabaciones retiradas. No tiene columna de persona en estudio:
-- una grabación acá no se lista en la historia de nadie. De dónde salió se sigue sabiendo, por
-- la grabación y la evolución de origen: es la trazabilidad que la decisión pide. Sigue siendo
-- dato clínico (una voz identifica): mismo cifrado, mismo vencimiento y mismo registro de escuchas.
-- El vencimiento y la fecha de grabación no tienen valor por defecto: se copian de la
-- grabación original. Pasar al depósito no puede ser una forma de guardar un audio más tiempo.
CREATE TABLE IF NOT EXISTS "unassigned_dictation_audios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"source_audio_id" uuid NOT NULL,
	"evolution_id" uuid NOT NULL,
	"take" integer NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_sec" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_encrypted" text,
	"segments_encrypted" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone,
	"declared_by" text NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unassigned_dictation_audios" ADD CONSTRAINT "unassigned_dictation_audios_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unassigned_dictation_audios" ADD CONSTRAINT "unassigned_dictation_audios_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unassigned_dictation_audios" ADD CONSTRAINT "unassigned_dictation_audios_source_audio_id_fk" FOREIGN KEY ("source_audio_id") REFERENCES "dictation_audios"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unassigned_dictation_audios" ADD CONSTRAINT "unassigned_dictation_audios_evolution_id_fk" FOREIGN KEY ("evolution_id") REFERENCES "clinical_evolutions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unassigned_dictation_audios_source_uniq" ON "unassigned_dictation_audios" USING btree ("source_audio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unassigned_dictation_audios_org_study_idx" ON "unassigned_dictation_audios" USING btree ("organization_id","study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unassigned_dictation_audios_org_author_idx" ON "unassigned_dictation_audios" USING btree ("organization_id","created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unassigned_dictation_audios_expires_idx" ON "unassigned_dictation_audios" USING btree ("expires_at");--> statement-breakpoint
-- La grabación original queda, vacía, con la fecha en que se retiró. Así no se confunde con
-- una vencida (que lleva su fecha de borrado) y el listado puede decir qué pasó con ella.
-- La fila original no se borra nunca: el depósito cuelga de ella.
ALTER TABLE "dictation_audios" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone;
