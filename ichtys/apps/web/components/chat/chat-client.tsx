'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  fetchConversationMessages,
  fetchConversations,
  fetchMessageCitations,
  sendChatQuestion,
} from './chat-api'
import { ConfidenceBadge } from './confidence-badge'
import { EvidenceList } from './evidence-list'
import type { ChatTurn, ConversationListItem, Evidence, MessageItem } from './types'

type ChatClientProps = {
  studyId: string
  studyName: string
  protocolNumber: string | null
  initialConversationId?: string | null
}

const SAFE_ERROR_MESSAGE = 'No se pudo completar la operacion. Intenta nuevamente.'
const SUGGESTED_QUESTIONS = [
  '¿Cuáles son las visitas del protocolo?',
  '¿Cuáles son los criterios de inclusión?',
  '¿Qué medicación concomitante está prohibida?',
]

export default function ChatClient({ studyId, studyName, protocolNumber, initialConversationId = null }: ChatClientProps) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [question, setQuestion] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadConversations() {
      setIsLoadingHistory(true)
      setHistoryError(null)
      try {
        const loaded = await fetchConversations(studyId)
        if (cancelled) return
        setConversations(loaded)
        if (initialConversationId && loaded.some((item) => item.conversationId === initialConversationId)) {
          setSelectedConversationId(initialConversationId)
        } else {
          setSelectedConversationId(loaded.at(0)?.conversationId ?? null)
        }
      } catch {
        if (cancelled) return
        setHistoryError('No se pudo cargar el historial. Podes iniciar una consulta nueva.')
      } finally {
        if (!cancelled) setIsLoadingHistory(false)
      }
    }

    void loadConversations()

    return () => {
      cancelled = true
    }
  }, [studyId, initialConversationId])

  useEffect(() => {
    let cancelled = false

    async function loadMessages(conversationId: string) {
      setIsLoadingMessages(true)
      setMessagesError(null)
      try {
        const messages = await fetchConversationMessages(conversationId)
        const hydrated = await hydrateMessagesWithCitations(messages)
        if (cancelled) return
        setTurns(hydrated)
      } catch {
        if (cancelled) return
        setMessagesError('No se pudieron cargar los mensajes de esta conversacion.')
      } finally {
        if (!cancelled) setIsLoadingMessages(false)
      }
    }

    if (!selectedConversationId) {
      setTurns([])
      setMessagesError(null)
      return
    }

    void loadMessages(selectedConversationId)

    return () => {
      cancelled = true
    }
  }, [selectedConversationId])

  const canSend = useMemo(() => question.trim().length > 0 && !isSending, [question, isSending])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) return

    setIsSending(true)
    setSendError(null)

    const pendingUserTurn: ChatTurn = {
      messageId: `pending-user-${Date.now()}`,
      role: 'user',
      content: trimmedQuestion,
      confidence: null,
      evidences: [],
      retrievalCount: null,
    }

    setTurns((current) => [...current, pendingUserTurn])
    setQuestion('')

    try {
      const result = await sendChatQuestion({
        studyId,
        question: trimmedQuestion,
        conversationId: selectedConversationId,
      })

      setSelectedConversationId(result.conversationId)
      setTurns((current) => [
        ...replacePendingUserTurn(current, pendingUserTurn.messageId, result.userMessageId),
        {
          messageId: result.assistantMessageId,
          role: 'assistant',
          content: result.answer,
          confidence: result.confidence,
          evidences: result.confidence === 'insufficient_evidence' ? [] : result.evidences,
          retrievalCount: result.retrievalCount,
        },
      ])
      setConversations((current) => upsertConversation(current, studyId, result.conversationId))
    } catch {
      setSendError(SAFE_ERROR_MESSAGE)
      setTurns((current) => current.filter((turn) => turn.messageId !== pendingUserTurn.messageId))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="border-b pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Chat documental</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-950">{studyName}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Study ID: {studyId}
          {protocolNumber ? <span> | Protocolo {protocolNumber}</span> : null}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-md border border-gray-200 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Conversaciones</h2>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setSelectedConversationId(null)
                setTurns([])
                setMessagesError(null)
              }}
            >
              Nueva
            </button>
          </div>
          {isLoadingHistory ? <p className="text-sm text-gray-500">Cargando historial...</p> : null}
          {historyError ? <p className="text-sm text-amber-700">{historyError}</p> : null}
          {!isLoadingHistory && conversations.length === 0 ? (
            <p className="text-sm text-gray-500">No hay conversaciones previas.</p>
          ) : null}
          <div className="space-y-2">
            {conversations.map((conversation) => (
              <button
                key={conversation.conversationId}
                type="button"
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                  conversation.conversationId === selectedConversationId
                    ? 'border-blue-300 bg-blue-50 text-blue-900'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedConversationId(conversation.conversationId)}
              >
                <span className="block font-medium">
                  {conversation.title ?? 'Conversacion sin titulo'}
                </span>
                <span className="block text-xs text-gray-500">{formatDate(conversation.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[620px] flex-col rounded-md border border-gray-200">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messagesError ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {messagesError} Podes seguir preguntando.
              </p>
            ) : null}
            {isLoadingMessages ? <p className="text-sm text-gray-500">Cargando mensajes...</p> : null}
            <ChatMessageList turns={turns} />
            {turns.length === 0 && !isLoadingMessages ? (
              <p className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                Escribi una pregunta sobre los documentos disponibles del estudio.
              </p>
            ) : null}
            <ChatTransientStatus isSending={isSending} sendError={sendError} />
          </div>

          <form className="border-t border-gray-200 p-4" onSubmit={handleSubmit}>
            <label htmlFor="chat-question" className="sr-only">
              Pregunta
            </label>
            <textarea
              id="chat-question"
              className="min-h-24 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Escribi una pregunta clinica o documental..."
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setQuestion(item)}
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                Usá preguntas completas sobre el protocolo o manuales; evitá consultas de una sola palabra.
              </p>
              <button
                type="submit"
                disabled={!canSend}
                className="rounded-md bg-gray-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {isSending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

export function ChatMessageList({ turns }: { turns: ChatTurn[] }) {
  return (
    <div className="space-y-4">
      {turns.map((turn) => (
        <article
          key={turn.messageId}
          className={`rounded-md p-4 ${
            turn.role === 'user' ? 'ml-auto max-w-2xl bg-gray-950 text-white' : 'mr-auto bg-white'
          }`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide">
              {turn.role === 'user' ? 'Pregunta' : 'Respuesta'}
            </span>
            {turn.confidence ? <ConfidenceBadge confidence={turn.confidence} /> : null}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6">{turn.content}</p>
          {turn.confidence === 'insufficient_evidence' ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {buildInsufficientEvidenceHint(turn.retrievalCount)}
            </p>
          ) : null}
          {turn.role === 'assistant' ? <EvidenceList evidences={turn.evidences} /> : null}
        </article>
      ))}
    </div>
  )
}

export function ChatTransientStatus({
  isSending,
  sendError,
}: {
  isSending: boolean
  sendError: string | null
}) {
  return (
    <>
      {isSending ? <p className="text-sm text-gray-500">Generando respuesta...</p> : null}
      {sendError ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {sendError}
        </p>
      ) : null}
    </>
  )
}

async function hydrateMessagesWithCitations(messages: MessageItem[]): Promise<ChatTurn[]> {
  return Promise.all(
    messages.map(async (message): Promise<ChatTurn> => {
      if (message.role === 'user') {
        return {
          messageId: message.messageId,
          role: message.role,
          content: message.content,
          confidence: null,
          evidences: [],
          retrievalCount: null,
          createdAt: message.createdAt,
        }
      }

      let evidences: Evidence[] = []
      try {
        evidences = await fetchMessageCitations(message.messageId)
      } catch {
        evidences = []
      }

      return {
        messageId: message.messageId,
        role: message.role,
        content: message.content,
        confidence: message.confidence,
        evidences,
        retrievalCount: null,
        createdAt: message.createdAt,
      }
    }),
  )
}

function replacePendingUserTurn(
  turns: ChatTurn[],
  pendingMessageId: string,
  persistedMessageId: string,
): ChatTurn[] {
  return turns.map((turn) =>
    turn.messageId === pendingMessageId ? { ...turn, messageId: persistedMessageId } : turn,
  )
}

function upsertConversation(
  conversations: ConversationListItem[],
  studyId: string,
  conversationId: string,
): ConversationListItem[] {
  if (conversations.some((conversation) => conversation.conversationId === conversationId)) {
    return conversations
  }

  const now = new Date().toISOString()
  return [
    {
      conversationId,
      studyId,
      title: null,
      createdAt: now,
      updatedAt: now,
    },
    ...conversations,
  ]
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('es', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function buildInsufficientEvidenceHint(retrievalCount?: number | null): string {
  if ((retrievalCount ?? 0) === 0) {
    return 'No encontré fragmentos relevantes en los documentos indexados para esa pregunta.'
  }

  return 'Encontré fragmentos, pero no fueron suficientemente relevantes. Probá una pregunta más específica (por ejemplo: visitas, criterios, medicación o procedimientos).'
}
