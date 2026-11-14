-- 0020 — Cuántas tomas tuvo una evolución dictada (docs/decisions/consulta-dictada.md, D22).
-- Aditiva: una columna opcional. Las evoluciones que ya existen quedan sin valor.
-- Para qué: hoy, si la última toma no dejó grabación, nadie se entera después; lo mismo si no
-- quedó ninguna. Con la cantidad de tomas guardada, la pantalla puede decir cuáles faltan.
-- Se escribe una sola vez, al crear la evolución. No es contenido clínico: es un número.
-- Se puede aplicar antes que el código: el código anterior no la manda y queda vacía.
ALTER TABLE "clinical_evolutions" ADD COLUMN IF NOT EXISTS "dictation_takes" integer;
