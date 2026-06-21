import { validateStudyAccess } from '@ichtys/auth'
import ChatClient from '../../../../../components/chat/chat-client'

interface ChatPageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ conversationId?: string }>
}

export default async function StudyChatPage({ params, searchParams }: ChatPageProps) {
  const { id: studyId } = await params
  const query = searchParams ? await searchParams : undefined
  const { study } = await validateStudyAccess(studyId)

  return (
    <ChatClient
      studyId={study.id}
      studyName={study.name}
      protocolNumber={study.protocolNumber}
      initialConversationId={query?.conversationId ?? null}
    />
  )
}
