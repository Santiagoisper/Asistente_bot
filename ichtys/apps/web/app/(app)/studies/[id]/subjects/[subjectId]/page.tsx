import { AccessError, validateSubjectAccess } from '@ichtys/auth'
import SubjectEvolutionClient from '../../../../../../components/subjects/subject-evolution-client'

interface SubjectDetailPageProps {
  params: Promise<{ id: string; subjectId: string }>
}

export default async function SubjectDetailPage({ params }: SubjectDetailPageProps) {
  const { id: studyId, subjectId } = await params
  try {
    await validateSubjectAccess(subjectId, studyId)
  } catch (err) {
    if (err instanceof AccessError && err.status === 404) {
      return <p className="text-sm text-alphi-rose">Sujeto no pertenece a este estudio.</p>
    }
    throw err
  }

  return <SubjectEvolutionClient studyId={studyId} subjectId={subjectId} />
}
