-- 0028: saca del chat las columnas en claro (cierre del chat cifrado).
-- QUITA (regla 48): se aplica DESPUÉS de integrar el código que dejó de leerlas (#232),
-- con los conteos en cero medidos en el momento y con el sí de Santiago.
-- Antes de aplicar, en cada base:
--   SELECT count(*) FROM messages WHERE content IS NOT NULL;            -- tiene que dar 0
--   SELECT count(*) FROM messages WHERE content_encrypted IS NULL;      -- tiene que dar 0
--   SELECT count(*) FROM conversations WHERE title IS NOT NULL;         -- tiene que dar 0
--   SELECT count(*) FROM messages WHERE annotations IS NOT NULL
--     AND annotations::text NOT IN ('null', '[]');                     -- tiene que dar 0
-- No tiene vuelta atrás sin restaurar la base: tomar una instantánea antes.
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_content_present";
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "content_encrypted" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "content";
--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "annotations";
--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "title";
