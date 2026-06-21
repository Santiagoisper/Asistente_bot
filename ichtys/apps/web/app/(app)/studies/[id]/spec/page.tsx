import { validateStudyAccess } from '@ichtys/auth'
import { getLatestStudySpec } from '@ichtys/ingestion'
import { studySpecSchema } from '@ichtys/ingestion'
import SpecReview from '../../../../../components/spec/spec-review'

interface SpecPageProps {
  params: Promise<{ id: string }>
}

export default async function StudySpecPage({ params }: SpecPageProps) {
  const { id: studyId } = await params
  const { orgId } = await validateStudyAccess(studyId)

  const row = await getLatestStudySpec({ orgId, studyId })

  if (!row) {
    return (
      <div className="py-12 text-center text-sm text-gray-500">
        <p>No hay spec extraído todavía.</p>
        <p className="mt-1">Subí un protocolo y el spec se generará automáticamente.</p>
      </div>
    )
  }

  const spec = studySpecSchema.parse(row.spec)

  return (
    <SpecReview
      specId={row.id}
      studyId={studyId}
      version={row.version}
      status={row.status as 'draft' | 'approved' | 'superseded'}
      extractionModel={row.extractionModel}
      createdAt={row.createdAt.toISOString()}
      spec={spec}
    />
  )
}
