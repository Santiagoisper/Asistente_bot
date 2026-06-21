import { sql } from 'drizzle-orm'
import { db } from '../packages/db/index'
async function main() {
  console.log('Dropping IVFFlat index...')
  await db.execute(sql`DROP INDEX IF EXISTS chunks_embedding_idx`)
  console.log('Creating HNSW index (no probes needed)...')
  await db.execute(sql`
    CREATE INDEX chunks_embedding_idx 
    ON chunks USING hnsw (embedding vector_cosine_ops) 
    WITH (m = 16, ef_construction = 64)
  `)
  await db.execute(sql`ANALYZE chunks`)
  console.log('Done!')
  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
