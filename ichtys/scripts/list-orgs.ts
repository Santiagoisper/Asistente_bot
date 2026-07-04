/**
 * Lista organizaciones y recursos asociados (diagnóstico pre-cleanup).
 */
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

async function main(): Promise<void> {
  const { db, eq } = await import('../packages/db/index')
  const {
    organizations,
    studies,
    documents,
    chunks,
    conversations,
  } = await import('../packages/db/schema/index')

  const orgs = await db.select().from(organizations)

  for (const org of orgs) {
    const orgStudies = await db.select().from(studies).where(eq(studies.organizationId, org.id))
    const orgDocs = await db.select({ id: documents.id }).from(documents).where(eq(documents.organizationId, org.id))
    const orgChunks = await db.select({ id: chunks.id }).from(chunks).where(eq(chunks.organizationId, org.id))
    const orgConvs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.organizationId, org.id))

    console.log('---')
    console.log('id:', org.id)
    console.log('name:', org.name)
    console.log('clerkOrgId:', org.clerkOrgId)
    console.log('stats:', {
      studies: orgStudies.length,
      documents: orgDocs.length,
      chunks: orgChunks.length,
      conversations: orgConvs.length,
    })
    for (const s of orgStudies) {
      console.log(`  study: ${s.name} (${s.id})`)
    }
  }
  console.log('\nTotal orgs:', orgs.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
