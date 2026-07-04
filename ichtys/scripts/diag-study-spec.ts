import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../apps/web/.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx)
  const value = trimmed.slice(eqIdx + 1)
  if (!process.env[key]) process.env[key] = value
}

const STUDY_ID = process.env.STUDY_ID ?? 'f2a9c57a-bd18-41f6-b597-7f823dbb9dd7'
const ORG = '1f3cde8b-be2a-4adf-9bbc-a2cf54163920'

async function main() {
  const { getLatestStudySpec, isMeaningfulSpec } = await import('../packages/ingestion/spec-store.ts')
  const { studySpecSchema } = await import('../packages/ingestion/study-spec.ts')
  const { db, studySpecs, eq, desc } = await import('../packages/db/index.ts')

  const row = await getLatestStudySpec({ orgId: ORG, studyId: STUDY_ID })
  console.log('getLatestStudySpec:', row ? `v${row.version} ${row.status} model=${row.extractionModel}` : 'NULL')

  if (row) {
    const parsed = studySpecSchema.safeParse(row.spec)
    if (!parsed.success) {
      console.log('ZOD FAIL:', JSON.stringify(parsed.error.issues.slice(0, 8), null, 2))
    } else {
      console.log('ZOD OK meaningful:', isMeaningfulSpec(parsed.data))
      console.log('counts:', {
        incl: parsed.data.inclusionCriteria.length,
        excl: parsed.data.exclusionCriteria.length,
        end: parsed.data.endpoints.length,
        vis: parsed.data.visits.length,
      })
    }
  }

  const all = await db.select().from(studySpecs).where(eq(studySpecs.studyId, STUDY_ID)).orderBy(desc(studySpecs.version)).limit(3)
  for (const r of all) {
    const p = studySpecSchema.safeParse(r.spec)
    console.log(`v${r.version} parse:`, p.success ? 'OK' : p.error.issues[0]?.message)
  }
}

main().catch(console.error)
