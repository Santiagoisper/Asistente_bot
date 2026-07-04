/**
 * Deja una sola organización en Neon: migra el estudio demo MOCK y borra el resto.
 *
 * Uso:
 *   npx tsx@4.19.2 scripts/consolidate-single-org.ts --confirm
 *
 * Keeper por defecto: INNOVA TRIALS (org Clerk del usuario).
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

/** INNOVA TRIALS — org activa en Clerk del usuario */
const KEEP_ORG_ID = process.env.KEEP_ORG_ID ?? '1f3cde8b-be2a-4adf-9bbc-a2cf54163920'
const KEEP_CLERK_ORG_ID = process.env.KEEP_CLERK_ORG_ID ?? 'org_3Fmf1xkFzmdDYWYIrfWEetueRAz'
const MOCK_STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'

async function deleteOrganization(orgId: string): Promise<void> {
  const { db, eq, inArray } = await import('../packages/db/index')
  const {
    organizations,
    studySpecs,
    conversations,
    ingestionJobs,
    citations,
    messages,
    chunks,
    studies,
    documents,
    documentVersions,
    pages,
    subjects,
    sites,
    screeningAssessments,
    patientProfiles,
    clinicalEvolutions,
  } = await import('../packages/db/schema/index')

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) })
  if (!org) {
    console.log(`  skip: org ${orgId} not found`)
    return
  }

  console.log(`\nDeleting org: ${org.name} (${org.id})`)

  const orgStudies = await db.select({ id: studies.id }).from(studies).where(eq(studies.organizationId, orgId))
  const studyIds = orgStudies.map((s) => s.id)

  await db.delete(studySpecs).where(eq(studySpecs.organizationId, orgId))

  const convs = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.organizationId, orgId))
  const convIds = convs.map((c) => c.id)

  if (convIds.length > 0) {
    const msgs = await db
      .select({ id: messages.id })
      .from(messages)
      .where(inArray(messages.conversationId, convIds))
    const msgIds = msgs.map((m) => m.id)
    if (msgIds.length > 0) {
      await db.delete(citations).where(inArray(citations.messageId, msgIds))
    }
    await db.delete(conversations).where(eq(conversations.organizationId, orgId))
  }

  // Orphan messages (p. ej. si conversations ya se borró en un intento previo)
  const orphanMsgs = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.organizationId, orgId))
  const orphanMsgIds = orphanMsgs.map((m) => m.id)
  if (orphanMsgIds.length > 0) {
    await db.delete(citations).where(inArray(citations.messageId, orphanMsgIds))
    await db.delete(messages).where(eq(messages.organizationId, orgId))
  }

  await db.delete(ingestionJobs).where(eq(ingestionJobs.organizationId, orgId))
  await db.delete(screeningAssessments).where(eq(screeningAssessments.organizationId, orgId))
  await db.delete(patientProfiles).where(eq(patientProfiles.organizationId, orgId))
  await db.delete(clinicalEvolutions).where(eq(clinicalEvolutions.organizationId, orgId))
  await db.delete(pages).where(eq(pages.organizationId, orgId))
  await db.delete(chunks).where(eq(chunks.organizationId, orgId))
  await db.delete(documentVersions).where(eq(documentVersions.organizationId, orgId))
  await db.delete(documents).where(eq(documents.organizationId, orgId))
  await db.delete(subjects).where(eq(subjects.organizationId, orgId))
  await db.delete(studies).where(eq(studies.organizationId, orgId))
  await db.delete(sites).where(eq(sites.organizationId, orgId))
  await db.delete(organizations).where(eq(organizations.id, orgId))

  console.log(`  deleted org + ${studyIds.length} studies`)
}

async function migrateMockStudyToKeeper(): Promise<void> {
  const { db, eq } = await import('../packages/db/index')
  const { studies, documents, documentVersions, chunks, studySpecs, conversations } =
    await import('../packages/db/schema/index')

  const mockStudy = await db.query.studies.findFirst({ where: eq(studies.id, MOCK_STUDY_ID) })
  if (!mockStudy) {
    console.log('MOCK study not found — will seed after cleanup if needed')
    return
  }
  if (mockStudy.organizationId === KEEP_ORG_ID) {
    console.log('MOCK study already under keeper org')
    return
  }

  console.log(`\nMigrating MOCK-METABOLIC-T2D-v1 → keeper org (${KEEP_ORG_ID})`)

  await db.update(studies).set({ organizationId: KEEP_ORG_ID }).where(eq(studies.id, MOCK_STUDY_ID))
  await db.update(documents).set({ organizationId: KEEP_ORG_ID }).where(eq(documents.studyId, MOCK_STUDY_ID))
  await db
    .update(documentVersions)
    .set({ organizationId: KEEP_ORG_ID })
    .where(eq(documentVersions.studyId, MOCK_STUDY_ID))
  await db.update(chunks).set({ organizationId: KEEP_ORG_ID }).where(eq(chunks.studyId, MOCK_STUDY_ID))
  await db.update(studySpecs).set({ organizationId: KEEP_ORG_ID }).where(eq(studySpecs.studyId, MOCK_STUDY_ID))
  await db
    .update(conversations)
    .set({ organizationId: KEEP_ORG_ID })
    .where(eq(conversations.studyId, MOCK_STUDY_ID))

  console.log('  migration complete')
}

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--confirm')
  if (!confirmed) {
    console.error('Dry run blocked. Pass --confirm to execute deletion.')
    console.error(`Keeper: INNOVA TRIALS (${KEEP_ORG_ID})`)
    process.exit(1)
  }

  const { db, eq, ne } = await import('../packages/db/index')
  const { organizations } = await import('../packages/db/schema/index')

  const allOrgs = await db.select().from(organizations)
  const toDelete = allOrgs.filter((o) => o.id !== KEEP_ORG_ID)

  console.log('=== Consolidate single org ===')
  console.log('Keeper:', KEEP_ORG_ID, KEEP_CLERK_ORG_ID)
  console.log('Orgs to delete:', toDelete.map((o) => o.name).join(', '))

  await migrateMockStudyToKeeper()

  for (const org of toDelete) {
    await deleteOrganization(org.id)
  }

  const remaining = await db.select().from(organizations)
  console.log('\n=== Done ===')
  console.log('Remaining orgs:', remaining.length)
  for (const o of remaining) {
    console.log(`  ${o.name} — clerk: ${o.clerkOrgId}`)
  }
}

main().catch((err) => {
  console.error('ERROR:', err instanceof Error ? err.message : err)
  process.exit(1)
})
