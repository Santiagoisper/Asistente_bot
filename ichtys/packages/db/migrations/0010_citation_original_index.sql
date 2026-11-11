-- Índice original del fragmento citado por el modelo. Las filas anteriores
-- quedan en NULL: su numeración no puede reconstruirse con seguridad.
-- Aplicar antes de desplegar el código que inserta citation_index.
ALTER TABLE "citations" ADD COLUMN IF NOT EXISTS "citation_index" integer;

CREATE UNIQUE INDEX IF NOT EXISTS "citations_message_citation_index_idx"
  ON "citations" USING btree ("message_id", "citation_index");
