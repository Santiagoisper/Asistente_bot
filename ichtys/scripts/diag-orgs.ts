import { sql } from 'drizzle-orm'
import { db } from '../packages/db/index'

const STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'

async function main() {
  // Check org_id distribution for this study
  const orgs = await db.execute(sql`
    SELECT organization_id, COUNT(*) as cnt 
    FROM chunks 
    WHERE study_id = ${STUDY_ID} 
    GROUP BY organization_id
  `)
  console.log('Org ID distribution:', JSON.stringify(orgs.rows, null, 2))
  
  // Check what org the MOCK study belongs to
  const study = await db.execute(sql`
    SELECT id, name, organization_id FROM studies WHERE id = ${STUDY_ID}
  `)
  console.log('Study org_id:', JSON.stringify(study.rows[0], null, 2))
  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
