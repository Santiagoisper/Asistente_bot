import { validatePhiStudyAccess, AccessError } from '@ichtys/auth'
import SubjectsClient from '../../../../../components/subjects/subjects-client'

interface SubjectsPageProps {
  params: Promise<{ id: string }>
}

export default async function StudySubjectsPage({ params }: SubjectsPageProps) {
  const { id: studyId } = await params

  try {
    await validatePhiStudyAccess(studyId)
  } catch (err) {
    if (err instanceof AccessError && err.status === 403) {
      return (
        <p className="text-sm text-alphi-muted">
          Tu rol (monitor de solo lectura) no tiene acceso al módulo de sujetos.
        </p>
      )
    }
    throw err
  }

  return <SubjectsClient studyId={studyId} />
}
