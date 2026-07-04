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

const ORG =
  process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a)) ??
  '1f3cde8b-be2a-4adf-9bbc-a2cf54163920'
const SKIP_MOCK = process.argv.includes('--skip-mock')

type RowResult = {
  studyId: string
  name: string
  ok: boolean
  beforeRichness: number
  afterRichness: number
  version: number | null
  incl: number
  excl: number
  ep: number
  vis: number
  error?: string
}

async function main() {
  const { and, db, documents, documentVersions, eq, studies } = await import('../packages/db/index.ts')
  const { getProtocolDocumentVersionId, reextractStudySpec, specRichness } = await import(
    '../packages/ingestion/reextract-spec.ts',
  )
  const { getLatestStudySpec, isMeaningfulSpec } = await import('../packages/ingestion/spec-store.ts')
  const { studySpecSchema } = await import('../packages/ingestion/study-spec.ts')

  const studyList = await db.query.studies.findMany({
    where: eq(studies.organizationId, ORG),
    orderBy: (s, { asc }) => [asc(s.name)],
  })

  const results: RowResult[] = []

  for (const study of studyList) {
    if (SKIP_MOCK && study.name.startsWith('MOCK-')) {
      console.log(`\n⏭ skip MOCK ${study.name}`)
      continue
    }

    const docVer = await getProtocolDocumentVersionId({ orgId: ORG, studyId: study.id })
    if (!docVer) {
      console.log(`\n⏭ skip (sin protocolo) ${study.name}`)
      continue
    }

    const ver = await db.query.documentVersions.findFirst({
      where: eq(documentVersions.id, docVer),
    })
    if (!ver || ver.status !== 'ready') {
      console.log(`\n⏭ skip (doc no ready) ${study.name}`)
      continue
    }

    const before = await getLatestStudySpec({ orgId: ORG, studyId: study.id })
    const beforeParsed = before ? studySpecSchema.safeParse(before.spec) : null
    const beforeRichness =
      beforeParsed?.success ? specRichness(beforeParsed.data) : 0

    console.log(`\n▶ ${study.name} (${study.id.slice(0, 8)}…) before richness=${beforeRichness}`)

    try {
      const result = await reextractStudySpec({
        orgId: ORG,
        studyId: study.id,
        documentVersionId: docVer,
      })

      const after = await getLatestStudySpec({ orgId: ORG, studyId: study.id })
      const afterParsed = after ? studySpecSchema.safeParse(after.spec) : null
      if (!afterParsed?.success || !after) {
        throw new Error('Spec post-reextract no parsea')
      }

      const row: RowResult = {
        studyId: study.id,
        name: study.name.slice(0, 50),
        ok: isMeaningfulSpec(afterParsed.data),
        beforeRichness,
        afterRichness: specRichness(afterParsed.data),
        version: after.version,
        incl: afterParsed.data.inclusionCriteria.length,
        excl: afterParsed.data.exclusionCriteria.length,
        ep: afterParsed.data.endpoints.length,
        vis: afterParsed.data.visits.length,
      }
      results.push(row)
      console.log(
        `  ✓ v${result.version} richness=${row.afterRichness} incl=${row.incl} excl=${row.excl} ep=${row.ep} vis=${row.vis}`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        studyId: study.id,
        name: study.name.slice(0, 50),
        ok: false,
        beforeRichness,
        afterRichness: 0,
        version: null,
        incl: 0,
        excl: 0,
        ep: 0,
        vis: 0,
        error: msg.slice(0, 120),
      })
      console.log(`  ✗ FAIL: ${msg.slice(0, 200)}`)
    }
  }

  console.log('\n========== RESUMEN ==========')
  console.table(
    results.map((r) => ({
      estudio: r.name,
      ok: r.ok ? '✓' : '✗',
      v: r.version,
      incl: r.incl,
      excl: r.excl,
      ep: r.ep,
      vis: r.vis,
      richness: r.afterRichness,
      delta: r.afterRichness - r.beforeRichness,
      error: r.error ?? '',
    })),
  )

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
