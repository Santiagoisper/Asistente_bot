/**
 * Loop E2E producto — protocolo, spec, pacientes, screening, ventanas, RAG.
 *
 * Uso: pnpm e2e:product
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_ORG_ID, DEMO_STUDY_ID } from './lib/mock-demo-constants'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const envPath = join(ROOT, 'apps/web/.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx)
  const value = trimmed.slice(eqIdx + 1)
  if (!process.env[key]) process.env[key] = value
}
process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'openai'

type Check = { name: string; ok: boolean; detail?: string }

const checks: Check[] = []
function pass(name: string, detail?: string): void {
  checks.push({ name, ok: true, detail })
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name: string, detail?: string): void {
  checks.push({ name, ok: false, detail })
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  console.log('\n=== E2E Product Loop — MOCK-METABOLIC-T2D-v1 ===\n')

  const { seedMockStudySpecIfMissing, MOCK_METABOLIC_STUDY_SPEC } = await import(
    './lib/seed-mock-spec-lib'
  )
  const seeded = await seedMockStudySpecIfMissing()
  pass('Study spec', seeded ? 'created + approved' : 'already present')

  const v6 = MOCK_METABOLIC_STUDY_SPEC.visits.find((v) => v.name === 'V6')
  if (v6?.windowDays === 7 && v6.day === 169) {
    pass('Visit windows in spec', 'V6 ±7 days @ Day 169')
  } else {
    fail('Visit windows in spec', 'V6 missing or wrong')
  }

  const { getLatestStudySpec } = await import('../packages/ingestion/spec-store')
  const specRow = await getLatestStudySpec({
    orgId: DEMO_ORG_ID,
    studyId: DEMO_STUDY_ID,
    approvedOnly: false,
  })
  if (specRow && specRow.spec) {
    pass('Spec persisted in DB', `v${specRow.version} status=${specRow.status}`)
  } else {
    fail('Spec persisted in DB')
  }

  const { assessScreening, screeningSummary } = await import('../packages/clinical/screening-engine')
  const { studySpecSchema } = await import('../packages/ingestion/study-spec')
  const spec = studySpecSchema.parse(MOCK_METABOLIC_STUDY_SPEC)

  const profileOk = {
    version: 1 as const,
    labs: [{ name: 'HbA1c', value: 9.0, unit: '%' }],
    medications: [{ name: 'Metformina', dose: '850 mg' }],
    conditions: [] as string[],
  }
  const screeningOk = assessScreening(profileOk, {
    inclusionCriteria: spec.inclusionCriteria,
    exclusionCriteria: spec.exclusionCriteria,
  })
  const sumOk = screeningSummary(screeningOk)
  const hba1c = screeningOk.find((a) => a.criterionNumber === '3')
  if (hba1c?.status === 'pass') {
    pass('Screening HbA1c 9%', hba1c.reason)
  } else {
    fail('Screening HbA1c 9%', hba1c?.reason ?? 'criterion 3 not pass')
  }

  const profilePanc = {
    ...profileOk,
    conditions: ['Pancreatitis aguda 2019'],
  }
  const screeningPanc = assessScreening(profilePanc, {
    inclusionCriteria: spec.inclusionCriteria,
    exclusionCriteria: spec.exclusionCriteria,
  })
  const panc = screeningPanc.find((a) => /pancreatitis/i.test(a.criterionText))
  if (panc?.status === 'fail') {
    pass('Screening pancreatitis exclusion', panc.reason)
  } else {
    fail('Screening pancreatitis exclusion', panc?.status ?? 'no assessment')
  }

  pass('Screening summary (eligible profile)', `pass=${sumOk.pass} fail=${sumOk.fail} unknown=${sumOk.unknown}`)

  const { getOrgRagConfig, updateOrgRagConfig } = await import('../packages/db/org-config')
  const ragBefore = await getOrgRagConfig(DEMO_ORG_ID)
  const ragPatched = await updateOrgRagConfig(DEMO_ORG_ID, {
    similarityThreshold: 0.2,
    topK: 10,
  })
  if (ragPatched.similarityThreshold === 0.2 && ragPatched.topK === 10) {
    pass('Org RAG config patch', `threshold=0.2 topK=10`)
  } else {
    fail('Org RAG config patch', `got threshold=${ragPatched.similarityThreshold} topK=${ragPatched.topK}`)
  }
  await updateOrgRagConfig(DEMO_ORG_ID, {
    similarityThreshold: ragBefore.similarityThreshold,
    topK: ragBefore.topK,
  })
  const ragRestored = await getOrgRagConfig(DEMO_ORG_ID)
  if (
    ragRestored.similarityThreshold === ragBefore.similarityThreshold &&
    ragRestored.topK === ragBefore.topK
  ) {
    pass('Org RAG config restore', 'reverted to prior values')
  } else {
    fail('Org RAG config restore')
  }

  const { answerEngine, retrieveRelevantChunks } = await import('../packages/rag/answer-engine')
  const { runMockMetabolicEvals, printSummary } = await import('../packages/evals/runner')
  const datasetPath = join(ROOT, 'packages/evals/dataset/mock-metabolic-eval-cases.json')

  const report = await runMockMetabolicEvals({
    adapter: async (question, studyId) => {
      const chunks = await retrieveRelevantChunks({
        queryText: question,
        orgId: DEMO_ORG_ID,
        studyId,
      })
      return answerEngine({ question, retrievedChunks: chunks })
    },
    studyId: DEMO_STUDY_ID,
    baseUrl: 'direct://rag',
    datasetPath,
    outputDir: join(ROOT, 'docs/evals/results'),
    concurrency: 2,
  })

  if (report.failCount === 0 && report.errorCount === 0) {
    pass('RAG eval suite', `${report.passCount}/${report.totalCases} PASS`)
  } else {
    fail('RAG eval suite', `PASS=${report.passCount} FAIL=${report.failCount} ERROR=${report.errorCount}`)
  }
  printSummary(report)

  if (process.env.PHI_ENCRYPTION_KEY?.trim()) {
    const { db, eq } = await import('../packages/db/index')
    const { subjects, patientProfiles } = await import('../packages/db/schema/index')
    const { encryptPhiField, decryptPhiField } = await import('../packages/crypto/phi-crypto')
    const code = `MOCK-E2E-${Date.now().toString(36).toUpperCase()}`
    const profileEnc = encryptPhiField(JSON.stringify({ version: 1, labs: [], medications: [], conditions: [] }))

    const [subject] = await db
      .insert(subjects)
      .values({
        organizationId: DEMO_ORG_ID,
        studyId: DEMO_STUDY_ID,
        subjectCode: code,
        status: 'screening',
      })
      .returning({ id: subjects.id })

    if (!subject) {
      fail('PHI subject round-trip', 'subject insert failed')
    } else {
      await db.insert(patientProfiles).values({
        organizationId: DEMO_ORG_ID,
        studyId: DEMO_STUDY_ID,
        subjectId: subject.id,
        profileEncrypted: profileEnc,
      })

      const [row] = await db
        .select({ profileEncrypted: patientProfiles.profileEncrypted })
        .from(patientProfiles)
        .where(eq(patientProfiles.subjectId, subject.id))
        .limit(1)

      const roundTrip = row ? decryptPhiField(row.profileEncrypted) : null
      await db.delete(subjects).where(eq(subjects.id, subject.id))

      if (roundTrip && JSON.parse(roundTrip).version === 1) {
        pass('PHI subject round-trip', `created + deleted ${code}`)
      } else {
        fail('PHI subject round-trip', 'decrypt mismatch')
      }
    }
  } else {
    pass('PHI subject round-trip', 'skip — PHI_ENCRYPTION_KEY not set locally')
  }

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n=== Resumen: ${checks.length - failed.length}/${checks.length} OK ===\n`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
