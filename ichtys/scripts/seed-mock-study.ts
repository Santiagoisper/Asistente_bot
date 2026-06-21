/**
 * Seed script — crea org y study mock para smoke test 10A.
 * Uso: npx tsx scripts/seed-mock-study.ts
 * Solo para desarrollo local. No commitear con datos reales.
 */
import { db, organizations, studies, eq } from '../packages/db/index'

const CLERK_ORG_ID = 'org_3Emh0j274SoeBVmpICF4gnlWlVR'
const STUDY_NAME = 'MOCK-METABOLIC-T2D-v1'

async function main() {
  // 1. Upsert organization
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, CLERK_ORG_ID),
  })

  let orgId: string
  if (existing) {
    orgId = existing.id
    console.log('Organization already exists:', existing)
  } else {
    const [org] = await db
      .insert(organizations)
      .values({ clerkOrgId: CLERK_ORG_ID, name: 'Ichtys Dev Org' })
      .returning()
    orgId = org!.id
    console.log('Organization created:', org)
  }

  // 2. Upsert study
  const existingStudy = await db.query.studies.findFirst({
    where: eq(studies.name, STUDY_NAME),
  })

  if (existingStudy) {
    console.log('Study already exists:', existingStudy)
    console.log('\nIDs:')
    console.log('  orgId:', orgId)
    console.log('  studyId:', existingStudy.id)
  } else {
    const [study] = await db
      .insert(studies)
      .values({ organizationId: orgId, name: STUDY_NAME, protocolNumber: 'MOCK-001' })
      .returning()
    console.log('Study created:', study)
    console.log('\nIDs:')
    console.log('  orgId:', orgId)
    console.log('  studyId:', study!.id)
  }
}

main().catch(console.error)
