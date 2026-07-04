/**
 * Eval RAG directo — sin HTTP ni Clerk. Prueba retrieval + answer engine contra Neon.
 *
 * Uso:
 *   pnpm evals:direct
 *   pnpm evals:direct -- --filter SM-001,SM-002,SM-003,SM-004,SM-005,SM-006
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
process.env.RATE_LIMIT_ENABLED = 'false'

function parseCaseFilterArg(): string[] | undefined {
  const idx = process.argv.indexOf('--filter')
  if (idx === -1 || !process.argv[idx + 1]) return undefined
  return process.argv[idx + 1]!
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

async function main(): Promise<void> {
  const { answerEngine, retrieveRelevantChunks } = await import('../packages/rag/answer-engine')
  const { runMockMetabolicEvals, printSummary } = await import('../packages/evals/runner')

  const caseFilter = parseCaseFilterArg()
  const datasetPath = join(ROOT, 'packages/evals/dataset/mock-metabolic-eval-cases.json')
  const outputDir = join(ROOT, 'docs/evals/results')

  console.log('[direct-rag-eval] orgId=', DEMO_ORG_ID)
  console.log('[direct-rag-eval] studyId=', DEMO_STUDY_ID)
  console.log('[direct-rag-eval] EMBEDDING_PROVIDER=', process.env.EMBEDDING_PROVIDER)

  const adapter = async (question: string, studyId: string) => {
    const retrievedChunks = await retrieveRelevantChunks({
      queryText: question,
      orgId: DEMO_ORG_ID,
      studyId,
    })
    return answerEngine({ question, retrievedChunks })
  }

  const report = await runMockMetabolicEvals({
    adapter,
    studyId: DEMO_STUDY_ID,
    baseUrl: 'direct://rag',
    datasetPath,
    outputDir,
    caseFilter,
    concurrency: 2,
  })

  printSummary(report)
  process.exit(report.failCount === 0 && report.errorCount === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[direct-rag-eval] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
