import { sql } from 'drizzle-orm'
import { db } from '../packages/db/index'

async function main() {
  console.log('VACUUM ANALYZE...')
  await db.execute(sql`VACUUM ANALYZE chunks`)
  
  console.log('Dropping old IVFFlat index...')
  await db.execute(sql`DROP INDEX IF EXISTS chunks_embedding_idx`)
  
  console.log('Recreating IVFFlat index with lists=10 (appropriate for ~700 rows)...')
  await db.execute(sql`
    CREATE INDEX chunks_embedding_idx 
    ON chunks USING ivfflat (embedding vector_cosine_ops) 
    WITH (lists = 10)
  `)
  
  console.log('ANALYZE...')
  await db.execute(sql`ANALYZE chunks`)
  
  console.log('Done! Index rebuilt.')
  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
