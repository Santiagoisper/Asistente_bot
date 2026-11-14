-- 0020 — Cuántas tomas tuvo una evolución dictada (docs/decisions/consulta-dictada.md, D22).
-- Aditiva: una columna opcional. Las evoluciones que ya existen quedan sin valor.
-- Para qué: hoy, si la última toma no dejó grabación, nadie se entera después; lo mismo si no
-- quedó ninguna. Con la cantidad de tomas guardada, la pantalla puede decir cuáles faltan.
-- Se escribe una sola vez, al crear la evolución. No es contenido clínico: es un número.
-- Se puede aplicar antes que el código: el código anterior no la manda y queda vacía.
ALTER TABLE "clinical_evolutions" ADD COLUMN IF NOT EXISTS "dictation_takes" integer;--> statement-breakpoint
-- Un cero o un negativo haría que la pantalla diga cosas raras sobre las tomas que faltan.
-- El tope de tomas vive en el código (hoy cinco): acá solo se pide que sea al menos una.
DO $$ BEGIN
 ALTER TABLE "clinical_evolutions" ADD CONSTRAINT "clinical_evolutions_dictation_takes_check" CHECK ("dictation_takes" IS NULL OR "dictation_takes" >= 1);
EXCEPTION WHEN duplicate_object THEN null; END $$;
