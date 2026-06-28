import { validateStudyAccess } from '@ichtys/auth'
import { getLatestStudySpec, studySpecSchema } from '@ichtys/ingestion'
import { annotateAnswerSync } from '@ichtys/rag/medical-annotator'
import SpecReview from '../../../../../components/spec/spec-review'
import type { EligibilityCriterion } from '@ichtys/ingestion'
import type { MedicalAnnotation } from '@ichtys/rag/medical-annotator'

interface SpecPageProps {
  params: Promise<{ id: string }>
}

export type AnnotatedCriterion = EligibilityCriterion & {
  /** SNOMED-CT / LOINC annotations detected in criterion text. < 2 ms, no I/O. */
  annotations: MedicalAnnotation[]
}

/**
 * Annotates every criterion with SNOMED-CT / LOINC codes at read time.
 * Annotations are deterministic from the text, so we don't persist them —
 * computing them here avoids a circular dependency between @ichtys/ingestion
 * and @ichtys/rag.
 */
function annotateCriteria(criteria: EligibilityCriterion[]): AnnotatedCriterion[] {
  return criteria.map((c) => ({
    ...c,
    annotations: annotateAnswerSync(c.text),
  }))
}

export default async function StudySpecPage({ params }: SpecPageProps) {
  const { id: studyId } = await params
  const { orgId } = await validateStudyAccess(studyId)

  const row = await getLatestStudySpec({ orgId, studyId })

  if (!row) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-alphi-teallit">
          <span className="text-2xl">🔬</span>
        </div>
        <p className="text-sm font-semibold text-alphi-navy">Sin spec extraído todavía</p>
        <p className="mt-1 text-sm text-alphi-muted">
          Subí un protocolo y ALPHI extraerá automáticamente los criterios, endpoints y visitas.
        </p>
      </div>
    )
  }

  const spec = studySpecSchema.parse(row.spec)

  // Annotate criteria with SNOMED-CT / LOINC — deterministic, < 2 ms total
  const annotatedInclusion = annotateCriteria(spec.inclusionCriteria)
  const annotatedExclusion = annotateCriteria(spec.exclusionCriteria)

  return (
    <SpecReview
      specId={row.id}
      studyId={studyId}
      version={row.version}
      status={row.status as 'draft' | 'approved' | 'superseded'}
      extractionModel={row.extractionModel}
      createdAt={row.createdAt.toISOString()}
      spec={spec}
      annotatedInclusion={annotatedInclusion}
      annotatedExclusion={annotatedExclusion}
    />
  )
}
