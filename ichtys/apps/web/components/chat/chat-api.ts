import type {
  AnswerConfidence,
  ChatResponse,
  CitationItem,
  ConversationListItem,
  DocumentType,
  Evidence,
  MessageItem,
} from './types'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const CONFIDENCE_VALUES = ['high', 'medium', 'low', 'insufficient_evidence'] as const

export type ChatRequestBody = {
  studyId: string
  question: string
  conversationId?: string
  documentType?: DocumentType
  topK?: number
}

export type SendChatQuestionInput = {
  studyId: string
  question: string
  conversationId?: string | null
  documentType?: DocumentType
  topK?: number
}

export class ChatUiError extends Error {
  constructor(readonly code: 'request_failed' | 'invalid_response') {
    super('Chat request failed')
    this.name = 'ChatUiError'
  }
}

export function buildChatRequestBody(input: SendChatQuestionInput): ChatRequestBody {
  const body: ChatRequestBody = {
    studyId: input.studyId,
    question: input.question,
  }

  if (input.conversationId) body.conversationId = input.conversationId
  if (input.documentType) body.documentType = input.documentType
  if (input.topK !== undefined) body.topK = input.topK

  return body
}

export async function sendChatQuestion(
  input: SendChatQuestionInput,
  fetcher: FetchLike = fetch,
): Promise<ChatResponse> {
  const response = await fetcher('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChatRequestBody(input)),
  })

  if (!response.ok) {
    throw new ChatUiError('request_failed')
  }

  const payload: unknown = await response.json()
  const parsed = parseChatResponse(payload)
  if (!parsed) {
    throw new ChatUiError('invalid_response')
  }
  return parsed
}

export async function fetchConversations(
  studyId: string,
  fetcher: FetchLike = fetch,
): Promise<ConversationListItem[]> {
  const response = await fetcher(`/api/conversations?studyId=${encodeURIComponent(studyId)}`)
  if (!response.ok) throw new ChatUiError('request_failed')

  const payload: unknown = await response.json()
  if (!isRecord(payload) || !Array.isArray(payload.conversations)) {
    throw new ChatUiError('invalid_response')
  }

  return payload.conversations.filter(isConversationListItem)
}

export async function fetchConversationMessages(
  conversationId: string,
  fetcher: FetchLike = fetch,
): Promise<MessageItem[]> {
  const response = await fetcher(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  )
  if (!response.ok) throw new ChatUiError('request_failed')

  const payload: unknown = await response.json()
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    throw new ChatUiError('invalid_response')
  }

  return payload.messages.filter(isMessageItem)
}

export async function fetchMessageCitations(
  messageId: string,
  fetcher: FetchLike = fetch,
): Promise<CitationItem[]> {
  const response = await fetcher(`/api/citations/${encodeURIComponent(messageId)}`)
  if (!response.ok) throw new ChatUiError('request_failed')

  const payload: unknown = await response.json()
  if (!isRecord(payload) || !Array.isArray(payload.citations)) {
    throw new ChatUiError('invalid_response')
  }

  return payload.citations.filter(isCitationItem)
}

export function privatePdfDownloadHref(documentVersionId: string): string {
  return `/api/document-versions/${encodeURIComponent(documentVersionId)}/download`
}

export function pageLabel(pageStart: number | null, pageEnd: number | null): string | null {
  if (pageStart === null) return null
  if (pageEnd === null || pageEnd === pageStart) return `p. ${pageStart}`
  return `pp. ${pageStart}-${pageEnd}`
}

function parseChatResponse(payload: unknown): ChatResponse | null {
  if (!isRecord(payload)) return null
  if (
    typeof payload.conversationId !== 'string' ||
    typeof payload.userMessageId !== 'string' ||
    typeof payload.assistantMessageId !== 'string' ||
    typeof payload.answer !== 'string' ||
    !isAnswerConfidence(payload.confidence) ||
    !Array.isArray(payload.evidences) ||
    typeof payload.retrievalCount !== 'number'
  ) {
    return null
  }

  return {
    conversationId: payload.conversationId,
    userMessageId: payload.userMessageId,
    assistantMessageId: payload.assistantMessageId,
    answer: payload.answer,
    confidence: payload.confidence,
    evidences: payload.evidences.filter(isEvidence),
    retrievalCount: payload.retrievalCount,
  }
}

function isConversationListItem(value: unknown): value is ConversationListItem {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    typeof value.studyId === 'string' &&
    (typeof value.title === 'string' || value.title === null) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function isMessageItem(value: unknown): value is MessageItem {
  return (
    isRecord(value) &&
    typeof value.messageId === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    (isAnswerConfidence(value.confidence) || value.confidence === null) &&
    typeof value.createdAt === 'string'
  )
}

function isCitationItem(value: unknown): value is CitationItem {
  if (!isRecord(value)) return false
  return (
    typeof value.citationId === 'string' &&
    typeof value.documentName === 'string' &&
    typeof value.documentType === 'string' &&
    isEvidence(value)
  )
}

function isEvidence(value: unknown): value is Evidence {
  return (
    isRecord(value) &&
    typeof value.chunkId === 'string' &&
    typeof value.documentId === 'string' &&
    typeof value.documentVersionId === 'string' &&
    (typeof value.documentName === 'string' || value.documentName === undefined) &&
    (typeof value.documentType === 'string' || value.documentType === undefined) &&
    isNullableNumber(value.pageStart) &&
    isNullableNumber(value.pageEnd) &&
    (typeof value.sectionTitle === 'string' || value.sectionTitle === null) &&
    typeof value.excerpt === 'string'
  )
}

function isAnswerConfidence(value: unknown): value is AnswerConfidence {
  return CONFIDENCE_VALUES.some((confidence) => confidence === value)
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === 'number' || value === null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
