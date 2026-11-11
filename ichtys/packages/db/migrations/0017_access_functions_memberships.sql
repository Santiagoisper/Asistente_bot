-- 0017 — Acceso por estudio: funciones de la persona, membresías y modo de la organización.
-- Aditiva y sin efecto visible: ninguna consulta lee todavía estas tablas ni estas columnas.
-- Todas las organizaciones existentes quedan en modo 'open' (el comportamiento de hoy).
-- Diseño: docs/decisions/study-membership.md
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "access_mode" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "access_open_until" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organizations" ADD CONSTRAINT "organizations_access_mode_check" CHECK ("access_mode" IN ('open', 'enforced'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "studies_id_org_uniq" ON "studies" USING btree ("id","organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_functions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"function_key" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_functions" ADD CONSTRAINT "member_functions_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_functions" ADD CONSTRAINT "member_functions_function_key_check" CHECK ("function_key" IN ('investigator', 'study_coordinator', 'lab_assistant', 'regulatory_assistant', 'crf_assistant', 'operations_director', 'research_director', 'monitor', 'platform_admin'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_functions_active_uniq" ON "member_functions" USING btree ("organization_id","user_id","function_key") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_functions_org_user_idx" ON "member_functions" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"study_label" text,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_memberships" ADD CONSTRAINT "study_memberships_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_memberships" ADD CONSTRAINT "study_memberships_study_org_fk" FOREIGN KEY ("study_id","organization_id") REFERENCES "studies"("id","organization_id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "study_memberships_active_uniq" ON "study_memberships" USING btree ("study_id","user_id") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_memberships_org_user_idx" ON "study_memberships" USING btree ("organization_id","user_id") WHERE "revoked_at" is null;
