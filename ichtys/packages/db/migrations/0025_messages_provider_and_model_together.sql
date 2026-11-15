-- 0025 — Proveedor y modelo van juntos: o están los dos o no está ninguno (regla R6).
-- La 0024 dejaba pasar una respuesta con proveedor y sin modelo, o al revés (salvedad de Architect
-- al #212). El código siempre escribe los dos; ahora lo exige la base.
-- Ninguna fila cambia. Se puede aplicar antes que el código y dos veces sin error.
-- Si alguna fila existente tuviera uno solo de los dos, la sentencia falla y no cambia nada.
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_provider_and_model_together_check" CHECK (("provider" IS NULL) = ("model" IS NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;
