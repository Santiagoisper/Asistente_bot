import { sql } from 'drizzle-orm'
import { db } from '../packages/db/index'

function resolveStudyId(): string {
  const argStudyId = process.argv.find((arg) => arg.startsWith('--study-id='))?.split('=')[1]
  const envStudyId = process.env.STUDY_ID
  const studyId = argStudyId ?? envStudyId
  if (!studyId) {
    throw new Error('Missing study id. Use STUDY_ID env or --study-id=<uuid>.')
  }
  return studyId
}

async function main() {
  const studyId = resolveStudyId()
  const versionStatus = await db.execute(
    sql`SELECT status, count(*)::int AS count FROM document_versions WHERE study_id = ${studyId} GROUP BY status ORDER BY status`,
  )
  const chunkSummary = await db.execute(
    sql`SELECT COUNT(*)::int AS total_chunks, COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded_chunks FROM chunks WHERE study_id = ${studyId}`,
  )
  const sample = await db.execute(
    sql`SELECT page_start, page_end, left(coalesce(section_title, ''), 100) AS section_title, left(content, 220) AS snippet FROM chunks WHERE study_id = ${studyId} ORDER BY page_start ASC, created_at ASC LIMIT 8`,
  )

  console.log('Study ID:', studyId)
  console.log('Document versions by status:', JSON.stringify(versionStatus.rows, null, 2))
  console.log('Chunk summary:', JSON.stringify(chunkSummary.rows[0] ?? {}, null, 2))
  console.log('Sample chunks:', JSON.stringify(sample.rows, null, 2))
  process.exit(0)
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
