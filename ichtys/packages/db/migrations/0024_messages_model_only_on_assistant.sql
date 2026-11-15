-- 0024 — Un mensaje de la persona no tiene proveedor ni modelo: lo exige la base (regla R6).
-- Va aparte de la 0023 porque esa ya se integró y se aplicó con su contenido original.
-- Ninguna fila cambia: las dos columnas nacieron vacías, así que todo lo que existe cumple.
-- Se puede aplicar antes que el código y dos veces sin error.
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_model_only_on_assistant_check" CHECK ("role" = 'assistant' OR ("provider" IS NULL AND "model" IS NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;
