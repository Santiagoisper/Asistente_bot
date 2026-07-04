/**
 * Spec canónico del protocolo mock T2D — alimenta screening, ventanas y UI de spec.
 */
import type { StudySpec } from '../../packages/ingestion/study-spec'
import { studySpecSchema } from '../../packages/ingestion/study-spec'
import { DEMO_DOCUMENTS, DEMO_ORG_ID, DEMO_STUDY_ID } from './mock-demo-constants'

const P = { sourcePages: [43] as number[], confidence: 'high' as const }

export const MOCK_METABOLIC_STUDY_SPEC: StudySpec = {
  identification: {
    protocolCode: 'MOCK-001',
    title: 'MOCK-METABOLIC-T2D-v1 — Phase 2b IMT-201 in T2D',
    phase: '2b',
    sourcePages: [1, 2],
  },
  inclusionCriteria: [
    {
      number: '1',
      text: 'Male or female, aged 30 to 75 years inclusive at the time of informed consent.',
      ...P,
    },
    {
      number: '2',
      text: 'Clinical diagnosis of type 2 diabetes mellitus for at least 12 months prior to screening.',
      ...P,
    },
    {
      number: '3',
      text: 'Glycated hemoglobin (HbA1c) >= 7.0% and <= 10.0% at the Screening Visit (V1), as measured by the central laboratory.',
      sourcePages: [43, 44],
      confidence: 'high',
    },
    {
      number: '4',
      text: 'Body Mass Index (BMI) >= 25 kg/m2 and <= 45 kg/m2 at the Screening Visit.',
      ...P,
    },
    {
      number: '5',
      text: 'On a stable dose of metformin (1000 mg/day or higher) for at least 8 weeks prior to screening.',
      ...P,
    },
  ],
  exclusionCriteria: [
    {
      number: '1',
      text: 'History of any pancreatitis (acute or chronic) at any time prior to enrollment.',
      sourcePages: [44],
      confidence: 'high',
    },
    {
      number: '2',
      text: 'Type 1 diabetes mellitus or secondary diabetes.',
      ...P,
    },
  ],
  endpoints: [
    {
      type: 'primary',
      objective: 'Evaluate change in HbA1c from baseline to Week 24.',
      endpoint: 'Mean change in HbA1c at Week 24 vs baseline.',
      sourcePages: [18],
      confidence: 'high',
    },
  ],
  visits: [
    {
      name: 'V1',
      label: 'Screening/Baseline',
      day: 1,
      windowDays: null,
      procedures: ['Informed consent', 'HbA1c (central lab)', 'Physical examination'],
      sourcePages: [45],
      confidence: 'high',
    },
    {
      name: 'V4',
      label: 'Week 12',
      day: 85,
      windowDays: 3,
      procedures: ['Vital signs', 'HbA1c (central lab)', 'PK blood sample'],
      sourcePages: [46],
      confidence: 'high',
    },
    {
      name: 'V6',
      label: 'End of Study / Follow-Up',
      day: 169,
      windowDays: 7,
      procedures: ['Vital signs', 'HbA1c (central lab)', 'Return unused medication'],
      sourcePages: [47],
      confidence: 'high',
    },
  ],
}

export async function seedMockStudySpecIfMissing(): Promise<boolean> {
  const { saveStudySpec, getLatestStudySpec, isMeaningfulSpec } = await import(
    '../../packages/ingestion/spec-store'
  )
  const { db, eq, and, desc } = await import('../../packages/db/index')
  const { studySpecs } = await import('../../packages/db/schema/index')

  const existing = await getLatestStudySpec({
    orgId: DEMO_ORG_ID,
    studyId: DEMO_STUDY_ID,
    approvedOnly: false,
  })
  if (existing) {
    const parsed = studySpecSchema.safeParse(existing.spec)
    if (parsed.success && isMeaningfulSpec(parsed.data)) {
      return false
    }
  }

  const protocolDoc = DEMO_DOCUMENTS[0]!
  await saveStudySpec({
    orgId: DEMO_ORG_ID,
    studyId: DEMO_STUDY_ID,
    documentVersionId: protocolDoc.dvId,
    spec: MOCK_METABOLIC_STUDY_SPEC,
    extractionModel: 'seed-mock-spec',
  })

  const [latest] = await db
    .select({ id: studySpecs.id })
    .from(studySpecs)
    .where(and(eq(studySpecs.organizationId, DEMO_ORG_ID), eq(studySpecs.studyId, DEMO_STUDY_ID)))
    .orderBy(desc(studySpecs.version))
    .limit(1)

  if (latest) {
    await db.update(studySpecs).set({ status: 'approved' }).where(eq(studySpecs.id, latest.id))
  }

  return true
}
