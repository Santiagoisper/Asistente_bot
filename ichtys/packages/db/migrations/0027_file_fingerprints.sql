-- 0027 — Huella, quién y camino de cada archivo que entra (C4 paso 4).
-- Diseño: docs/decisions/huella-y-procedencia-de-archivos.md, sección 4 (la nota la llamaba
-- 0019, después 0023; esos números los tomaron otras migraciones). El 17/11/2026 la 0027
-- pasa a ser esta; quitar las columnas viejas del chat (antes «la 0027») va en una posterior.
--
-- SOLO AGREGA (regla 48): columnas nulas, ninguna fila cambia. Las filas anteriores quedan en
-- NULL, que se lee «no se registró»: no se calcula hacia atrás (recalcular hoy no prueba lo que
-- llegó entonces). Se aplica a mano, idempotente, en la base de prueba y en producción ANTES de
-- integrar el código que las escribe. Nunca con db:migrate.
--
-- Ninguna columna lleva dato de un paciente: una huella SHA-256 no permite reconstruir el
-- archivo, «uploaded_by» es el identificador de un usuario del sistema y «upload_channel» un
-- valor fijo.
--
-- 1. Documentos del estudio: huella del PDF tal como llegó, quién lo subió y por qué camino.
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "sha256" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "upload_channel" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_versions_upload_channel_known') THEN
    ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_upload_channel_known"
      CHECK (upload_channel IS NULL OR upload_channel IN ('single', 'bulk_import'));
  END IF;
END
$$;--> statement-breakpoint
-- 2. Informes de laboratorio: huella del archivo recibido, antes de leerlo. Quién y camino ya
--    están (created_by, source_kind).
ALTER TABLE "lab_reports" ADD COLUMN IF NOT EXISTS "source_sha256" text;--> statement-breakpoint
-- 3. Recortes de un informe en foto: huella de los bytes recibidos, antes de cifrar.
ALTER TABLE "lab_report_images" ADD COLUMN IF NOT EXISTS "sha256" text;
