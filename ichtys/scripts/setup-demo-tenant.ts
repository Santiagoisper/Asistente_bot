/**
 * setup-demo-tenant.ts — levanta el tenant demo mock T2D en un solo comando.
 *
 * Crea org + study + documents + document_versions + chunks con embeddings.
 * IDs determinísticos para alinear con eval runner y upload-mock-docs.mjs.
 *
 * Uso:
 *   DATABASE_URL=<neon> OPENAI_API_KEY=<key> pnpm demo:setup
 *
 * Opcional: DEMO_CLERK_ORG_ID (default org Ichtys Dev)
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, eq } from '../packages/db/index'
import {
  organizations,
  studies,
  documents,
  documentVersions,
} from '../packages/db/schema/index'
import {
  DEMO_CLERK_ORG_ID,
  DEMO_ORG_ID,
  DEMO_ORG_NAME,
  DEMO_STUDY_ID,
  DEMO_STUDY_NAME,
  DEMO_PROTOCOL_NUMBER,
  DEMO_DOCUMENTS,
  demoBlobKey,
  demoBlobUrl,
} from './lib/mock-demo-constants'
import { seedMockChunks } from './lib/seed-mock-chunks-lib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = join(__dirname, '../docs/evals/mock-metabolic-documents')

async function upsertOrganization(): Promise<string> {
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, DEMO_CLERK_ORG_ID),
  })

  if (existing) {
    if (existing.id !== DEMO_ORG_ID) {
      console.warn(
        `WARN: org exists with id=${existing.id} (expected ${DEMO_ORG_ID}). Using existing id.`,
      )
      return existing.id
    }
    console.log('Organization already exists:', existing.id)
    return existing.id
  }

  const [org] = await db
    .insert(organizations)
    .values({
      id: DEMO_ORG_ID,
      clerkOrgId: DEMO_CLERK_ORG_ID,
      name: DEMO_ORG_NAME,
    })
    .returning()

  console.log('Organization created:', org!.id)
  return org!.id
}

async function upsertStudy(orgId: string): Promise<string> {
  const existing = await db.query.studies.findFirst({
    where: eq(studies.id, DEMO_STUDY_ID),
  })

  if (existing) {
    console.log('Study already exists:', existing.id)
    return existing.id
  }

  const byName = await db.query.studies.findFirst({
    where: eq(studies.name, DEMO_STUDY_NAME),
  })
  if (byName) {
    console.warn(
      `WARN: study "${DEMO_STUDY_NAME}" exists with id=${byName.id} (expected ${DEMO_STUDY_ID}).`,
    )
    return byName.id
  }

  const [study] = await db
    .insert(studies)
    .values({
      id: DEMO_STUDY_ID,
      organizationId: orgId,
      name: DEMO_STUDY_NAME,
      protocolNumber: DEMO_PROTOCOL_NUMBER,
      status: 'active',
    })
    .returning()

  console.log('Study created:', study!.id)
  return study!.id
}

async function upsertDocuments(orgId: string, studyId: string): Promise<void> {
  for (const doc of DEMO_DOCUMENTS) {
    const existingDoc = await db.query.documents.findFirst({
      where: eq(documents.id, doc.docId),
    })

    if (!existingDoc) {
      await db.insert(documents).values({
        id: doc.docId,
        organizationId: orgId,
        studyId,
        name: doc.displayName,
        documentType: doc.docType,
      })
      console.log(`  document created: ${doc.displayName}`)
    }

    const existingDv = await db.query.documentVersions.findFirst({
      where: eq(documentVersions.id, doc.dvId),
    })

    if (!existingDv) {
      await db.insert(documentVersions).values({
        id: doc.dvId,
        documentId: doc.docId,
        organizationId: orgId,
        studyId,
        blobUrl: demoBlobUrl(doc.dvId),
        blobKey: demoBlobKey(doc.dvId),
        pageCount: 20,
        fileSizeBytes: 1024,
        status: 'ready',
        versionNumber: 1,
      })
      console.log(`  document_version ready: ${doc.pdfName}`)
    } else if (existingDv.status !== 'ready') {
      await db
        .update(documentVersions)
        .set({ status: 'ready', errorMessage: null })
        .where(eq(documentVersions.id, doc.dvId))
      console.log(`  document_version updated to ready: ${doc.pdfName}`)
    }
  }
}

async function main() {
  if (!process.env['DATABASE_URL']) {
    throw new Error('DATABASE_URL is not set')
  }
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set (required for chunk embeddings)')
  }

  console.log('=== ALPHI Demo Tenant Setup ===\n')
  console.log(`Clerk org: ${DEMO_CLERK_ORG_ID}`)
  console.log(`Docs dir:  ${DOCS_DIR}\n`)

  const orgId = await upsertOrganization()
  const studyId = await upsertStudy(orgId)

  console.log('\nUpserting documents + document_versions...')
  await upsertDocuments(orgId, studyId)

  console.log('\nSeeding chunks + embeddings (OpenAI)...')
  const totalChunks = await seedMockChunks({
    docsDir: DOCS_DIR,
    orgId,
    studyId,
    openAiApiKey: apiKey,
  })

  console.log('\n=== Setup complete ===')
  console.log(`  orgId:        ${orgId}`)
  console.log(`  studyId:      ${studyId}`)
  console.log(`  study name:   ${DEMO_STUDY_NAME}`)
  console.log(`  documents:    ${DEMO_DOCUMENTS.length}`)
  console.log(`  chunks:       ${totalChunks}`)
  console.log('\nNext steps:')
  console.log('  1. pnpm dev (apps/web)')
  console.log(`  2. Sign in with org ${DEMO_CLERK_ORG_ID}`)
  console.log(`  3. Open chat for study ${DEMO_STUDY_NAME}`)
  console.log('  4. Run demo questions from docs/evals/demo-script.md')
  console.log('\nEval (optional):')
  console.log(`  EVAL_STUDY_ID=${studyId} EVAL_AUTH_COOKIE=<cookies> pnpm evals:mock-metabolic`)
}

main().catch((err: unknown) => {
  console.error('ERROR:', err instanceof Error ? err.message : err)
  process.exit(1)
})
