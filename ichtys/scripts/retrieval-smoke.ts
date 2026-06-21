import { retrieveRelevantChunks } from '@ichtys/rag'
import { MIN_SIMILARITY_THRESHOLD } from '../packages/rag/guardrails'

type SmokeInput = {
  orgId: string
  studyId: string
}

function parseArgs(): SmokeInput {
  const argOrgId = process.argv.find((arg) => arg.startsWith('--org-id='))?.split('=')[1]
  const argStudyId = process.argv.find((arg) => arg.startsWith('--study-id='))?.split('=')[1]
  const orgId = argOrgId ?? process.env.ORG_ID
  const studyId = argStudyId ?? process.env.STUDY_ID

  if (!orgId || !studyId) {
    throw new Error('Missing org/study id. Use ORG_ID + STUDY_ID env vars or --org-id / --study-id.')
  }

  return { orgId, studyId }
}

async function runQuestion(input: SmokeInput, question: string): Promise<void> {
  const chunks = await retrieveRelevantChunks({
    orgId: input.orgId,
    studyId: input.studyId,
    queryText: question,
    topK: 8,
  })
  const aboveThreshold = chunks.filter((chunk) => chunk.similarityScore >= MIN_SIMILARITY_THRESHOLD)
  const top = chunks[0]

  console.log('\n--------------------------------')
  console.log(`Question: ${question}`)
  console.log(`Retrieved: ${chunks.length}`)
  console.log(`Above threshold (${MIN_SIMILARITY_THRESHOLD}): ${aboveThreshold.length}`)
  if (top) {
    console.log(`Top score: ${top.similarityScore.toFixed(3)} (p.${top.pageStart}-${top.pageEnd})`)
    console.log(`Top snippet: ${top.content.slice(0, 180).replace(/\s+/g, ' ')}`)
  }
}

async function main(): Promise<void> {
  const input = parseArgs()
  console.log(`Study: ${input.studyId}`)
  console.log(`Org: ${input.orgId}`)

  await runQuestion(input, 'visitas')
  await runQuestion(input, '¿Cuáles son las visitas del estudio según el protocolo GZBO?')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
