import { AccessError, validateSubjectAccess } from '@ichtys/auth'
import SubjectEvolutionClient from '../../../../../../components/subjects/subject-evolution-client'
import { loadOrgTimeZone } from '../../../../../../lib/os/org-settings'

interface SubjectDetailPageProps {
  params: Promise<{ id: string; subjectId: string }>
}

export default async function SubjectDetailPage({ params }: SubjectDetailPageProps) {
  const { id: studyId, subjectId } = await params
  let orgId: string
  try {
    orgId = (await validateSubjectAccess(subjectId, studyId)).orgId
  } catch (err) {
    if (err instanceof AccessError && err.status === 404) {
      return <p className="text-sm text-alphi-rose">Sujeto no pertenece a este estudio.</p>
    }
    throw err
  }

  // La hora de cada evolución se muestra en la zona del centro. El navegador no la conoce: se la pasa esta página.
  return <SubjectEvolutionClient studyId={studyId} subjectId={subjectId} timeZone={await loadOrgTimeZone(orgId)} />
}
