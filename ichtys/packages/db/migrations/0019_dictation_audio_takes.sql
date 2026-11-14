-- 0019 — Varias grabaciones por evolución dictada (docs/decisions/consulta-dictada.md, D22).
-- Aditiva: una columna con valor por defecto y un cambio de índice. No borra filas ni columnas.
-- Se puede aplicar antes que el código: el código anterior no manda la toma, guarda con el
-- valor por defecto (1) y sigue rechazando una segunda grabación de la misma evolución.
-- La unicidad nueva se crea antes de sacar la vieja: en ningún momento queda la tabla sin ella.
ALTER TABLE "dictation_audios" ADD COLUMN IF NOT EXISTS "take" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dictation_audios_evolution_take_uniq" ON "dictation_audios" USING btree ("evolution_id","take");--> statement-breakpoint
DROP INDEX IF EXISTS "dictation_audios_evolution_uniq";
