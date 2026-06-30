import { validateSubjectAccess } from '@ichtys/auth'
import SubjectEvolutionClient from '../../../../../../components/subjects/subject-evolution-client'

interface SubjectDetailPageProps {
  params: Promise<{ id: string; subjectId: string }>
}

export default async function SubjectDetailPage({ params }: SubjectDetailPageProps) {
  const { id: studyId, subjectId } = await params
  const { subject } = await validateSubjectAccess(subjectId)

  if (subject.studyId !== studyId) {
    return <p className="text-sm text-red-600">Sujeto no pertenece a este estudio.</p>
  }

  return <SubjectEvolutionClient studyId={studyId} subjectId={subjectId} />
}
