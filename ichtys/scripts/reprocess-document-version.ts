/**
 * Reprocessa un document_version localmente (usa DATABASE_URL de apps/web/.env.local).
 * Uso: npx tsx scripts/reprocess-document-version.ts <documentVersionId>
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function main(): Promise<void> {
  const { db, eq } = await import('../packages/db/index')
  const { documentVersions } = await import('../packages/db/schema/index')
  const { runIngestion } = await import('../packages/ingestion/pipeline')

  const documentVersionId = process.argv[2]
  if (!documentVersionId) {
    console.error('Usage: npx tsx scripts/reprocess-document-version.ts <documentVersionId>')
    process.exit(1)
  }

  const row = await db
    .select({
      documentVersionId: documentVersions.id,
      documentId: documentVersions.documentId,
      studyId: documentVersions.studyId,
      orgId: documentVersions.organizationId,
      status: documentVersions.status,
      errorMessage: documentVersions.errorMessage,
    })
    .from(documentVersions)
    .where(eq(documentVersions.id, documentVersionId))
    .limit(1)

  const info = row[0]
  if (!info) {
    console.error(`document_version not found: ${documentVersionId}`)
    process.exit(1)
  }

  console.log('Current status:', info.status, info.errorMessage ?? '')
  console.log('Running ingestion with EMBEDDING_PROVIDER=', process.env.EMBEDDING_PROVIDER)

  const result = await runIngestion({
    userId: 'system-reprocess',
    orgId: info.orgId,
    studyId: info.studyId,
    documentId: info.documentId,
    documentVersionId: info.documentVersionId,
  })

  console.log('Done:', result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
