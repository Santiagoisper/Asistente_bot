-- 0026 — El contenido de los mensajes y el título de la conversación, cifrados.
-- Decisiones del 16/11/2026: diseño de Architect (mensaje 7a7b2edf) con las tres decisiones
-- de Fable. PR-A del chat cifrado: SOLO AGREGA (regla 48). Se aplica y se verifica en la base
-- de prueba (Fable) y en producción (Santiago) ANTES de integrar el código que escribe estas
-- columnas; ninguna fila cambia. Las anotaciones NO se cifran: se dejan de guardar.
--
-- 1. messages.content_encrypted: el cuerpo del mensaje (pregunta y respuesta) es texto
--    clínico y va cifrado. "content" deja de ser obligatoria porque el código nuevo (PR-B)
--    deja de escribirla; queda para leer lo anterior hasta el sellado. Sacarla es la 0027.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "content_encrypted" text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
-- 2. conversations.title_encrypted: el título lo arma un modelo a partir de la primera
--    pregunta y puede llevar dato clínico: mismo tratamiento que el nombre del turno (0023).
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "title_encrypted" text;--> statement-breakpoint
-- 3. Todo mensaje sigue teniendo cuerpo: hoy lo garantiza NOT NULL; desde acá, la regla
--    (content heredada O la cifrada). El DO mira pg_constraint para no fallar si ya existe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_content_present') THEN
    ALTER TABLE "messages" ADD CONSTRAINT "messages_content_present"
      CHECK (content IS NOT NULL OR content_encrypted IS NOT NULL);
  END IF;
END
$$;
