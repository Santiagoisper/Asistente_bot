-- 0022 — Los tramos de lo dictado, junto a su grabación (docs/decisions/enlace-frase-audio.md).
-- Aditiva: una columna opcional. Las grabaciones que ya existen quedan sin tramos.
-- Guarda, cifrada, la lista de tramos tal como salieron del transcriptor: comienzo, fin y texto.
-- Es dato clínico y vence con la grabación: al borrarse el audio se vacía también esta columna.
-- Se puede aplicar antes que el código: el código anterior no la manda y queda vacía.
ALTER TABLE "dictation_audios" ADD COLUMN IF NOT EXISTS "segments_encrypted" text;
