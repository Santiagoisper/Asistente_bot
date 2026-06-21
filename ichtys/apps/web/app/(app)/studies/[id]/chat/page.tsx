import { validateStudyAccess } from '@ichtys/auth'
import ChatClient from '../../../../../components/chat/chat-client'

interface ChatPageProps {
  params: Promise<{ id: string }>
}

export default async function StudyChatPage({ params }: ChatPageProps) {
  const { id: studyId } = await params
  const { study } = await validateStudyAccess(studyId)

  return (
    <ChatClient
      studyId={study.id}
      studyName={study.name}
      protocolNumber={study.protocolNumber}
    />
  )
}
