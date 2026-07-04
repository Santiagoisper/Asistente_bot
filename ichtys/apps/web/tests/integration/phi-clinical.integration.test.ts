/**
 * IT — Integration tests PHI clinical (CSV Etapa 2 Fase 3).
 * Complementa OQ unitarios (mocks) con DB real Neon.
 *
 * Requiere apps/web/.env.local con DATABASE_URL + PHI_ENCRYPTION_KEY.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_ORG_ID, DEMO_STUDY_ID, hasIntegrationEnv } from './load-env'

describe.skipIf(!hasIntegrationEnv)('IT — PHI clinical (DB real)', () => {
  const createdSubjectIds: string[] = []

  afterEach(async () => {
    const { db, eq, subjects } = await import('@ichtys/db')
    for (const id of createdSubjectIds.splice(0)) {
      await db.delete(subjects).where(eq(subjects.id, id))
    }
  })

  async function createTestSubject(subjectCode: string) {
    const { db, subjects, patientProfiles } = await import('@ichtys/db')
    const { encryptProfileJson } = await import('../../lib/subjects/phi-fields')

    const [subject] = await db
      .insert(subjects)
      .values({
        organizationId: DEMO_ORG_ID,
        studyId: DEMO_STUDY_ID,
        subjectCode,
        status: 'screening',
      })
      .returning({ id: subjects.id })

    if (!subject) throw new Error('subject insert failed')

    await db.insert(patientProfiles).values({
      organizationId: DEMO_ORG_ID,
      studyId: DEMO_STUDY_ID,
      subjectId: subject.id,
      profileEncrypted: encryptProfileJson({
        version: 1,
        labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }],
        medications: [{ name: 'Metformina', dose: '850 mg' }],
        conditions: [],
      }),
    })

    createdSubjectIds.push(subject.id)
    return subject.id
  }

  it('IT-001 — profile cifrado at-rest (sin plaintext en DB)', async () => {
    const subjectId = await createTestSubject(`IT-ENC-${Date.now().toString(36).toUpperCase()}`)

    const { db, eq, patientProfiles } = await import('@ichtys/db')
    const [row] = await db
      .select({ profileEncrypted: patientProfiles.profileEncrypted })
      .from(patientProfiles)
      .where(eq(patientProfiles.subjectId, subjectId))
      .limit(1)

    expect(row?.profileEncrypted.startsWith('v1:')).toBe(true)
    expect(row?.profileEncrypted).not.toContain('HbA1c')
    expect(row?.profileEncrypted).not.toContain('Metformina')
  }, 30_000)

  it('IT-002 — loadPatientProfile round-trip decrypt', async () => {
    const subjectId = await createTestSubject(`IT-LOAD-${Date.now().toString(36).toUpperCase()}`)
    const { loadPatientProfile } = await import('../../lib/subjects/patient-profile-service')

    const profile = await loadPatientProfile({
      orgId: DEMO_ORG_ID,
      studyId: DEMO_STUDY_ID,
      subjectId,
    })

    expect(profile.labs[0]?.name).toBe('HbA1c')
    expect(profile.labs[0]?.value).toBe(8.2)
    expect(profile.medications[0]?.name).toBe('Metformina')
  }, 30_000)

  it('IT-003 — evaluateAndPersistScreening persiste snapshot', async () => {
    const subjectId = await createTestSubject(`IT-SCR-${Date.now().toString(36).toUpperCase()}`)

    const { getLatestStudySpec } = await import('@ichtys/ingestion/spec-store')
    const { studySpecSchema } = await import('@ichtys/ingestion/study-spec')
    const { loadPatientProfile } = await import('../../lib/subjects/patient-profile-service')
    const { evaluateAndPersistScreening } = await import('../../lib/subjects/screening-service')
    const { db, eq, screeningAssessments } = await import('@ichtys/db')

    const specRow = await getLatestStudySpec({
      orgId: DEMO_ORG_ID,
      studyId: DEMO_STUDY_ID,
      approvedOnly: true,
    })
    expect(specRow?.spec).toBeTruthy()
    if (!specRow?.spec || !specRow.documentVersionId) {
      throw new Error('demo study spec missing — run pnpm e2e:product once')
    }

    const spec = studySpecSchema.parse(specRow.spec)
    const profile = await loadPatientProfile({
      orgId: DEMO_ORG_ID,
      studyId: DEMO_STUDY_ID,
      subjectId,
    })

    const result = await evaluateAndPersistScreening({
      orgId: DEMO_ORG_ID,
      studyId: DEMO_STUDY_ID,
      subjectId,
      profile,
      spec,
      specVersion: specRow.version,
      documentVersionId: specRow.documentVersionId,
    })

    expect(result.persistedSnapshotId).toBeTruthy()
    expect(result.assessments.length).toBeGreaterThan(0)

    const snapshot = await db.query.screeningAssessments.findFirst({
      where: eq(screeningAssessments.id, result.persistedSnapshotId!),
    })
    expect(snapshot).toBeTruthy()
    expect(snapshot!.organizationId).toBe(DEMO_ORG_ID)
  }, 30_000)

  it('IT-004 — aislamiento org en loadPatientProfile', async () => {
    const subjectId = await createTestSubject(`IT-ISO-${Date.now().toString(36).toUpperCase()}`)
    const { loadPatientProfile } = await import('../../lib/subjects/patient-profile-service')

    const wrongOrg = crypto.randomUUID()
    const profile = await loadPatientProfile({
      orgId: wrongOrg,
      studyId: DEMO_STUDY_ID,
      subjectId,
    })

    expect(profile.labs).toEqual([])
    expect(profile.medications).toEqual([])
  }, 30_000)
})
