-- 0015 — Integraciones y ajustes del OS por organización.
-- Aditiva: una tabla nueva y una columna opcional. Sin fila, la organización
-- no tiene esa integración. Las credenciales solo se guardan cifradas.
CREATE TABLE IF NOT EXISTS "organization_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"integration_key" text NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"settings" jsonb,
	"secrets_encrypted" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_integrations" ADD CONSTRAINT "organization_integrations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_integrations_org_key_idx" ON "organization_integrations" USING btree ("organization_id","integration_key");--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "os_settings" jsonb;
