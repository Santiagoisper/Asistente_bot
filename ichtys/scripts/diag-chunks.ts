import { sql } from 'drizzle-orm'
import { db } from '../packages/db/index'

const STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'

async function main() {
  const total = await db.execute(sql`SELECT COUNT(*) as cnt FROM chunks WHERE study_id = ${STUDY_ID}`)
  const nonNull = await db.execute(sql`SELECT COUNT(*) as cnt FROM chunks WHERE study_id = ${STUDY_ID} AND embedding IS NOT NULL`)
  const sample = await db.execute(sql`SELECT id, section_title, octet_length(embedding::text) as emb_len FROM chunks WHERE study_id = ${STUDY_ID} LIMIT 5`)
  
  console.log('Total chunks:', total.rows[0])
  console.log('Non-null embeddings:', nonNull.rows[0])
  console.log('Sample rows:', JSON.stringify(sample.rows, null, 2))
  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
