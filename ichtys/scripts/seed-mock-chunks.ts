/**
 * seed-mock-chunks.ts — inserta chunks + embeddings para el study mock metabólico.
 *
 * Lee los 5 Markdowns mock, los chunkea por sección (## headers), genera
 * embeddings con text-embedding-3-small (OpenAI) e inserta en la tabla chunks.
 * Diseñado para el flujo de dev local donde los PDFs reales no están en Vercel Blob.
 *
 * IDs hardcodeados para coincidir con lo que seed-mock-study.ts + seeds de
 * document_versions insertan en la DB.
 *
 * Uso: DATABASE_URL=<...> OPENAI_API_KEY=<...> pnpm tsx scripts/seed-mock-chunks.ts
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from '../packages/db/index'
import { chunks } from '../packages/db/schema/index'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DOCS_DIR = join(ROOT, 'docs/evals/mock-metabolic-documents')

// These IDs must match what's already in the DB (seeded by seed-mock-study.ts + manual SQL)
const ORG_ID = '2d67f024-ff70-42fa-b73a-4a0500229855'
const STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'

const DOCS = [
  {
    docId: 'a0000000-0000-0000-0000-000000000001',
    dvId: 'b0000000-0000-0000-0000-000000000001',
    file: 'MOCK-METABOLIC-T2D-Protocol.md',
    docType: 'protocol' as const,
  },
  {
    docId: 'a0000000-0000-0000-0000-000000000002',
    dvId: 'b0000000-0000-0000-0000-000000000002',
    file: 'MOCK-METABOLIC-T2D-Investigator-Brochure.md',
    docType: 'investigator_brochure' as const,
  },
  {
    docId: 'a0000000-0000-0000-0000-000000000003',
    dvId: 'b0000000-0000-0000-0000-000000000003',
    file: 'MOCK-METABOLIC-T2D-Lab-Manual.md',
    docType: 'lab_manual' as const,
  },
  {
    docId: 'a0000000-0000-0000-0000-000000000004',
    dvId: 'b0000000-0000-0000-0000-000000000004',
    file: 'MOCK-METABOLIC-T2D-Pharmacy-Manual.md',
    docType: 'pharmacy_manual' as const,
  },
  {
    docId: 'a0000000-0000-0000-0000-000000000005',
    dvId: 'b0000000-0000-0000-0000-000000000005',
    file: 'MOCK-METABOLIC-T2D-Study-Procedures-Manual.md',
    docType: 'other' as const,
  },
]

interface RawChunk {
  sectionTitle: string
  content: string
  pageStart: number
  pageEnd: number
}

function chunkMarkdown(text: string): RawChunk[] {
  const result: RawChunk[] = []
  // Split on ## headers (level 2+)
  const sections = text.split(/^##\s+/m)

  let pageEstimate = 1

  for (const section of sections) {
    if (section.trim().length < 50) continue

    const lines = section.split('\n')
    const sectionTitle = lines[0]?.trim() ?? 'Content'
    const body = lines.slice(1).join('\n').trim()

    if (body.length < 30) continue

    // Sub-chunk if body is very long (>1200 chars)
    const MAX_CHARS = 1200
    if (body.length <= MAX_CHARS) {
      result.push({
        sectionTitle,
        content: `${sectionTitle}\n\n${body}`,
        pageStart: pageEstimate,
        pageEnd: pageEstimate,
      })
    } else {
      const words = body.split(/\s+/)
      let current = ''
      let subIdx = 0
      for (const word of words) {
        if ((current + ' ' + word).length > MAX_CHARS && current.length > 0) {
          result.push({
            sectionTitle: `${sectionTitle} (${subIdx + 1})`,
            content: `${sectionTitle}\n\n${current.trim()}`,
            pageStart: pageEstimate,
            pageEnd: pageEstimate,
          })
          subIdx++
          current = word
        } else {
          current = current ? current + ' ' + word : word
        }
      }
      if (current.trim().length > 30) {
        result.push({
          sectionTitle: `${sectionTitle} (${subIdx + 1})`,
          content: `${sectionTitle}\n\n${current.trim()}`,
          pageStart: pageEstimate,
          pageEnd: pageEstimate,
        })
      }
    }

    pageEstimate++
  }

  return result
}

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

  // Delete existing chunks for this study to avoid duplicates on re-run
  const { eq } = await import('../packages/db/node_modules/drizzle-orm')
  const deleted = await db.delete(chunks).where(eq(chunks.studyId, STUDY_ID))
  console.log(`Deleted existing chunks for study ${STUDY_ID}`)

  let totalChunks = 0

  for (const doc of DOCS) {
    const filePath = join(DOCS_DIR, doc.file)
    const text = readFileSync(filePath, 'utf-8')
    const rawChunks = chunkMarkdown(text)

    console.log(`\n${doc.file}: ${rawChunks.length} chunks`)

    for (let i = 0; i < rawChunks.length; i++) {
      const raw = rawChunks[i]!
      const preview = raw.content.slice(0, 60).replace(/\n/g, ' ')
      process.stdout.write(`  [${i + 1}/${rawChunks.length}] embedding "${preview}..."`)

      const embedding = await getEmbedding(raw.content, apiKey)

      await db.insert(chunks).values({
        documentId: doc.docId,
        documentVersionId: doc.dvId,
        organizationId: ORG_ID,
        studyId: STUDY_ID,
        documentType: doc.docType,
        pageStart: raw.pageStart,
        pageEnd: raw.pageEnd,
        sectionTitle: raw.sectionTitle,
        content: raw.content,
        tokenCount: Math.ceil(raw.content.length / 4),
        embedding: embedding as unknown as string,
      })

      process.stdout.write(' ✓\n')
      totalChunks++
    }
  }

  console.log(`\n✅ Inserted ${totalChunks} chunks for study ${STUDY_ID}`)
  console.log(`   org=${ORG_ID}`)
  console.log(`   study=${STUDY_ID}`)

  process.exit(0)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
