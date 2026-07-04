/**
 * seed-mock-chunks.ts — inserta chunks + embeddings para el study mock metabólico.
 *
 * Preferir: pnpm demo:setup (setup-demo-tenant.ts) que también crea org/study/docs.
 *
 * Uso: DATABASE_URL=<...> OPENAI_API_KEY=<...> pnpm tsx scripts/seed-mock-chunks.ts
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_ORG_ID, DEMO_STUDY_ID } from './lib/mock-demo-constants'
import { seedMockChunks } from './lib/seed-mock-chunks-lib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = join(__dirname, '../docs/evals/mock-metabolic-documents')

async function main() {
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const totalChunks = await seedMockChunks({
    docsDir: DOCS_DIR,
    orgId: DEMO_ORG_ID,
    studyId: DEMO_STUDY_ID,
    openAiApiKey: apiKey,
  })

  console.log(`\n✅ Inserted ${totalChunks} chunks for study ${DEMO_STUDY_ID}`)
  console.log(`   org=${DEMO_ORG_ID}`)
  process.exit(0)
}

main().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
