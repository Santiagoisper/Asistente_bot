/**
 * re-embed-study.ts — re-genera embeddings para todos los chunks de un estudio.
 *
 * NO borra ni re-inserta chunks — solo actualiza el campo embedding con vectores
 * frescos del modelo actual (text-embedding-3-small). Seguro de correr con
 * citations existentes.
 *
 * Uso:
 *   DATABASE_URL=<unpooled> OPENAI_API_KEY=<key> npx tsx scripts/re-embed-study.ts [STUDY_ID]
 *
 * Si no se pasa STUDY_ID usa el MOCK por defecto.
 */
import { db, eq } from '../packages/db/index'
import { chunks } from '../packages/db/schema/index'

const DEFAULT_STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'
const BATCH_SIZE = 20

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI embeddings failed: ${res.status} ${body}`)
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
  return json.data[0]!.embedding
}

async function main() {
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const studyId = process.argv[2] ?? DEFAULT_STUDY_ID
  console.log(`Re-embedding chunks for study: ${studyId}`)

  const rows = await db
    .select({ id: chunks.id, content: chunks.content, sectionTitle: chunks.sectionTitle })
    .from(chunks)
    .where(eq(chunks.studyId, studyId))

  console.log(`Found ${rows.length} chunks`)
  if (rows.length === 0) {
    console.log('No chunks found — nothing to do.')
    process.exit(0)
  }

  let updated = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    for (const row of batch) {
      const preview = row.content.slice(0, 60).replace(/\n/g, ' ')
      process.stdout.write(`  [${updated + 1}/${rows.length}] "${preview}..." `)
      const embedding = await getEmbedding(row.content, apiKey)
      await db
        .update(chunks)
        .set({ embedding: embedding as unknown as string })
        .where(eq(chunks.id, row.id))
      process.stdout.write('✓\n')
      updated++
    }
  }

  console.log(`\n✅ Re-embedded ${updated} chunks for study ${studyId}`)
  process.exit(0)
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
