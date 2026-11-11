-- 0016 — Alinea el índice de embeddings con HNSW ya instalado en producción.
-- La migración es no-op si el índice HNSW correcto existe y está válido.
-- En instalaciones que aún tienen IVFFlat, el reemplazo es transaccional.
DO $$
DECLARE
  existing_method text;
  existing_options text[];
  existing_is_expected boolean;
BEGIN
  SELECT am.amname,
         idx.reloptions,
         ix.indisvalid AND ix.indisready
           AND ix.indrelid = 'chunks'::regclass
           AND ix.indnatts = 1 AND ix.indnkeyatts = 1
           AND att.attname = 'embedding'
           AND opc.opcname = 'vector_cosine_ops'
           AND ix.indpred IS NULL AND ix.indexprs IS NULL
    INTO existing_method, existing_options, existing_is_expected
    FROM pg_class AS idx
    JOIN pg_am AS am ON am.oid = idx.relam
    JOIN pg_index AS ix ON ix.indexrelid = idx.oid
    LEFT JOIN pg_attribute AS att
      ON att.attrelid = ix.indrelid AND att.attnum = ix.indkey[0]
    LEFT JOIN pg_opclass AS opc ON opc.oid = ix.indclass[0]
   WHERE idx.oid = to_regclass('chunks_embedding_idx');

  IF existing_method = 'hnsw' THEN
    IF existing_is_expected IS NOT TRUE
       OR COALESCE((SELECT split_part(opt, '=', 2)::integer
                      FROM unnest(existing_options) AS opt WHERE opt LIKE 'm=%'), 16) <> 16
       OR COALESCE((SELECT split_part(opt, '=', 2)::integer
                      FROM unnest(existing_options) AS opt WHERE opt LIKE 'ef_construction=%'), 64) <> 64
    THEN
      RAISE EXCEPTION 'chunks_embedding_idx exists as HNSW with an unexpected definition';
    END IF;
    RETURN;
  ELSIF existing_method = 'ivfflat' THEN
    IF existing_is_expected IS NOT TRUE THEN
      RAISE EXCEPTION 'chunks_embedding_idx exists as IVFFlat with an unexpected definition';
    END IF;
    DROP INDEX "chunks_embedding_idx";
  ELSIF existing_method IS NOT NULL OR to_regclass('chunks_embedding_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'chunks_embedding_idx exists with an unexpected access method or object type';
  END IF;

  CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw
    ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
END $$;
