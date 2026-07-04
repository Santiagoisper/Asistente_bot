/**
 * Lógica compartida para chunkear Markdown mock e insertar embeddings.
 * Usada por seed-mock-chunks.ts y setup-demo-tenant.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, eq } from '../../packages/db/index'
import { chunks } from '../../packages/db/schema/index'
import { DEMO_DOCUMENTS, DEMO_ORG_ID, DEMO_STUDY_ID } from './mock-demo-constants'

export interface RawChunk {
  sectionTitle: string
  content: string
  pageStart: number
  pageEnd: number
}

export function chunkMarkdown(text: string): RawChunk[] {
  const result: RawChunk[] = []
  const sections = text.split(/^##\s+/m)
  let pageEstimate = 1

  for (const section of sections) {
    if (section.trim().length < 50) continue

    const lines = section.split('\n')
    const sectionTitle = lines[0]?.trim() ?? 'Content'
    const body = lines.slice(1).join('\n').trim()

    if (body.length < 30) continue

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

export async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
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

export interface SeedMockChunksOptions {
  docsDir: string
  orgId?: string
  studyId?: string
  openAiApiKey: string
  verbose?: boolean
}

export async function seedMockChunks(options: SeedMockChunksOptions): Promise<number> {
  const orgId = options.orgId ?? DEMO_ORG_ID
  const studyId = options.studyId ?? DEMO_STUDY_ID
  const verbose = options.verbose ?? true

  await db.delete(chunks).where(eq(chunks.studyId, studyId))
  if (verbose) {
    console.log(`Deleted existing chunks for study ${studyId}`)
  }

  let totalChunks = 0

  for (const doc of DEMO_DOCUMENTS) {
    const filePath = join(options.docsDir, doc.mdFile)
    const text = readFileSync(filePath, 'utf-8')
    const rawChunks = chunkMarkdown(text)

    if (verbose) {
      console.log(`\n${doc.mdFile}: ${rawChunks.length} chunks`)
    }

    for (let i = 0; i < rawChunks.length; i++) {
      const raw = rawChunks[i]!
      if (verbose) {
        const preview = raw.content.slice(0, 60).replace(/\n/g, ' ')
        process.stdout.write(`  [${i + 1}/${rawChunks.length}] embedding "${preview}..."`)
      }

      const embedding = await getEmbedding(raw.content, options.openAiApiKey)

      await db.insert(chunks).values({
        documentId: doc.docId,
        documentVersionId: doc.dvId,
        organizationId: orgId,
        studyId,
        documentType: doc.docType,
        pageStart: raw.pageStart,
        pageEnd: raw.pageEnd,
        sectionTitle: raw.sectionTitle,
        content: raw.content,
        tokenCount: Math.ceil(raw.content.length / 4),
        embedding: embedding as unknown as string,
      })

      if (verbose) process.stdout.write(' ✓\n')
      totalChunks++
    }
  }

  return totalChunks
}
