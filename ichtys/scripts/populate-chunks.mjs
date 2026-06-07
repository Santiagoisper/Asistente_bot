/**
 * populate-chunks.mjs — lee Markdown mock, crea chunks y embeddings
 * Usa OpenAI para generar embeddings y los inserta en Neon.
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load env
const envContent = readFileSync(join(ROOT, 'apps/web/.env.local'), 'utf8')
function getEnv(key) {
  const line = envContent.split('\n').find(l => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1).trim() : undefined
}

const OPENAI_KEY = getEnv('OPENAI_API_KEY')
const ORG_ID = '2d67f024-ff70-42fa-b73a-4a0500229855'
const STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'

const DOCS = [
  { docId: 'a0000000-0000-0000-0000-000000000001', dvId: 'b0000000-0000-0000-0000-000000000001', file: 'MOCK-METABOLIC-T2D-Protocol.md' },
  { docId: 'a0000000-0000-0000-0000-000000000002', dvId: 'b0000000-0000-0000-0000-000000000002', file: 'MOCK-METABOLIC-T2D-Investigator-Brochure.md' },
  { docId: 'a0000000-0000-0000-0000-000000000003', dvId: 'b0000000-0000-0000-0000-000000000003', file: 'MOCK-METABOLIC-T2D-Lab-Manual.md' },
  { docId: 'a0000000-0000-0000-0000-000000000004', dvId: 'b0000000-0000-0000-0000-000000000004', file: 'MOCK-METABOLIC-T2D-Pharmacy-Manual.md' },
  { docId: 'a0000000-0000-0000-0000-000000000005', dvId: 'b0000000-0000-0000-0000-000000000005', file: 'MOCK-METABOLIC-T2D-Study-Procedures-Manual.md' },
]

async function getEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  })
  if (!res.ok) throw new Error(`OpenAI API failed: ${res.status}`)
  const { data } = await res.json()
  return data[0].embedding
}

function chunkText(text, maxChars = 800) {
  const sections = text.split(/##\s+/).slice(1)
  const chunks = []
  for (const section of sections) {
    const lines = section.split('\n')
    let currentChunk = ''
    for (const line of lines) {
      if ((currentChunk + line).length > maxChars) {
        if (currentChunk) chunks.push(currentChunk.trim())
        currentChunk = line
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim())
  }
  return chunks.filter(c => c.length > 50)
}

async function main() {
  const docsDir = join(ROOT, 'docs/evals/mock-metabolic-documents')
  const allChunks = []

  for (const doc of DOCS) {
    console.log(`Processing ${doc.file}...`)
    const text = readFileSync(join(docsDir, doc.file), 'utf8')
    const chunks = chunkText(text)

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i]
      console.log(`  Chunk ${i + 1}/${chunks.length}: ${content.slice(0, 50)}...`)

      const embedding = await getEmbedding(content)
      allChunks.push({
        id: `chunk-${doc.dvId}-${i}`,
        documentVersionId: doc.dvId,
        documentId: doc.docId,
        organizationId: ORG_ID,
        studyId: STUDY_ID,
        content,
        embedding: `[${embedding.join(',')}]`, // JSON string for SQL
        pageStart: 1,
        pageEnd: 1,
        sectionTitle: 'Content',
      })
    }
  }

  console.log(`\nGenerated ${allChunks.length} chunks. Output SQL:`)
  const sqlValues = allChunks
    .map(
      c =>
        `('${c.id}', '${c.documentVersionId}', '${c.documentId}', '${c.organizationId}', '${c.studyId}', $$${c.content
          .replace(/\$/g, '\\$')
          .replace(/'/g, "''")}$$, '${c.embedding.replace(/'/g, "''")}', ${c.pageStart}, ${c.pageEnd}, $$${c.sectionTitle}$$)`
    )
    .join(',\n')

  console.log(`\nINSERT INTO chunks (id, document_version_id, document_id, organization_id, study_id, content, embedding, page_start, page_end, section_title) VALUES\n${sqlValues};`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
