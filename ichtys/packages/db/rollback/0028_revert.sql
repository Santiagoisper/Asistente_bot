-- Vuelta atrás de la 0028 (no es una migración: no va en migrations/ ni en el journal).
-- Devuelve la forma que tenía la base antes de la 0028: las tres columnas en claro,
-- vacías, `content_encrypted` sin NOT NULL y el CHECK `messages_content_present`.
-- No recupera datos: las columnas estaban en cero filas con valor cuando se aplicó la 0028
-- (producción, 2026-11-19 01:31Z). Para datos, la instantánea `antes-0028-2026-11-18`.
-- Ensayada en la base de prueba el 2026-11-19 dentro de una transacción revertida:
-- 0028 → esta vuelta atrás → mismas columnas, tipos, nulabilidad y CHECK que antes.
-- Se aplica en una sola transacción (BEGIN/COMMIT abajo; con psql, sin -1), con el sí de Santiago.
BEGIN;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "content" text;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "annotations" jsonb;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "messages" ALTER COLUMN "content_encrypted" DROP NOT NULL;
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_present" CHECK ("content" IS NOT NULL OR "content_encrypted" IS NOT NULL);
COMMIT;
