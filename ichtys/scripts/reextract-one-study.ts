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

const STUDY_ID = process.argv[2]
const ORG = process.argv[3] ?? '1f3cde8b-be2a-4adf-9bbc-a2cf54163920'

if (!STUDY_ID) {
  console.error('Usage: tsx scripts/reextract-one-study.ts <studyId> [orgId]')
  process.exit(1)
}

async function main() {
  const { getProtocolDocumentVersionId, reextractStudySpec } = await import(
    '../packages/ingestion/reextract-spec.ts'
  )
  const { getLatestStudySpec, isMeaningfulSpec } = await import('../packages/ingestion/spec-store.ts')
  const { studySpecSchema } = await import('../packages/ingestion/study-spec.ts')
  const { specRichness } = await import('../packages/ingestion/reextract-spec.ts')

  const before = await getLatestStudySpec({ orgId: ORG, studyId: STUDY_ID })
  if (before) {
    const p = studySpecSchema.safeParse(before.spec)
    console.log(
      'before:',
      `v${before.version}`,
      p.success ? specRichness(p.data) : 'zod-fail',
    )
  }

  const docVer = await getProtocolDocumentVersionId({ orgId: ORG, studyId: STUDY_ID })
  if (!docVer) throw new Error('No protocol document version')
  console.log('documentVersionId:', docVer)

  const result = await reextractStudySpec({
    orgId: ORG,
    studyId: STUDY_ID,
    documentVersionId: docVer,
  })
  console.log('reextract ok:', result)

  const after = await getLatestStudySpec({ orgId: ORG, studyId: STUDY_ID })
  if (after) {
    const p = studySpecSchema.safeParse(after.spec)
    if (p.success) {
      console.log('after:', {
        version: after.version,
        richness: specRichness(p.data),
        incl: p.data.inclusionCriteria.length,
        excl: p.data.exclusionCriteria.length,
        ep: p.data.endpoints.length,
        vis: p.data.visits.length,
        meaningful: isMeaningfulSpec(p.data),
      })
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
