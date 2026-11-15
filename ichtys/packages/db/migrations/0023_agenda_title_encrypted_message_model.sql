-- 0023 — El nombre del turno, cifrado; y con qué modelo se generó cada respuesta del asistente.
-- Decisiones del 15/11/2026 (docs/compliance/URS-OS.md, OS-25 y OS-26).
-- Tres columnas nuevas y una que deja de ser obligatoria; ninguna fila cambia.
-- Se puede aplicar antes que el código: el código anterior sigue escribiendo "title"
-- y no manda las columnas nuevas, que quedan vacías.
--
-- 1. agenda_items.title_encrypted: el nombre del turno es texto libre y va cifrado, como las notas.
--    "title" deja de ser obligatoria porque el código nuevo ya no escribe ahí; queda para leer los
--    turnos anteriores. Sacarla es otra migración, cuando no quede ninguno en claro.
ALTER TABLE "agenda_items" ADD COLUMN IF NOT EXISTS "title_encrypted" text;--> statement-breakpoint
ALTER TABLE "agenda_items" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
-- 2. messages.provider y messages.model: el proveedor y el modelo de cada respuesta (regla R6).
--    Vacías en los mensajes de la persona, en las respuestas sin llamada a un modelo y en lo anterior.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "provider" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "model" text;
