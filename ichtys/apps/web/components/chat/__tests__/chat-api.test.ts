import { describe, expect, it } from 'vitest'
import {
  buildChatRequestBody,
  fetchConversationMessages,
  fetchConversations,
  fetchMessageCitations,
  privatePdfDownloadHref,
  sendChatQuestion,
} from '../chat-api'

type FetchCall = {
  input: string
  init?: RequestInit
}

const STUDY_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_MESSAGE_ID = '33333333-3333-4333-8333-333333333333'
const ASSISTANT_MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const DOCUMENT_VERSION_ID = '55555555-5555-4555-8555-555555555555'
const MESSAGE_ID = '66666666-6666-4666-8666-666666666666'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeChatResponse(conversationId = CONVERSATION_ID) {
  return {
    conversationId,
    userMessageId: USER_MESSAGE_ID,
    assistantMessageId: ASSISTANT_MESSAGE_ID,
    answer: 'Use the schedule in the protocol.',
    confidence: 'high',
    evidences: [
      {
        chunkId: 'chunk-1',
        documentId: 'document-1',
        documentVersionId: DOCUMENT_VERSION_ID,
        pageStart: 4,
        pageEnd: 5,
        sectionTitle: 'Schedule',
        excerpt: 'Visit schedule excerpt.',
      },
    ],
    retrievalCount: 1,
  }
}

function makeFetcher(payload: unknown, calls: FetchCall[], status = 200) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init })
    return jsonResponse(payload, status)
  }
}

function parseBody(call: FetchCall): Record<string, unknown> {
  const body = call.init?.body
  expect(typeof body).toBe('string')
  const parsed: unknown = JSON.parse(String(body))
  expect(typeof parsed).toBe('object')
  expect(parsed).not.toBeNull()
  return parsed as Record<string, unknown>
}

describe('chat API helpers', () => {
  it('builds the chat payload without org or user identifiers', () => {
    const body = buildChatRequestBody({
      studyId: STUDY_ID,
      question: 'What is the visit schedule?',
      conversationId: CONVERSATION_ID,
      topK: 8,
    })

    expect(body).toEqual({
      studyId: STUDY_ID,
      question: 'What is the visit schedule?',
      conversationId: CONVERSATION_ID,
      topK: 8,
    })
    expect(body).not.toHaveProperty('orgId')
    expect(body).not.toHaveProperty('organizationId')
    expect(body).not.toHaveProperty('organization_id')
    expect(body).not.toHaveProperty('userId')
  })

  it('sends POST /api/chat with the expected body', async () => {
    const calls: FetchCall[] = []

    await sendChatQuestion(
      {
        studyId: STUDY_ID,
        question: 'What is the visit schedule?',
        conversationId: CONVERSATION_ID,
      },
      makeFetcher(makeChatResponse(), calls),
    )

    const firstCall = calls.at(0)
    expect(firstCall).toBeDefined()
    expect(firstCall?.input).toBe('/api/chat')
    expect(firstCall?.init?.method).toBe('POST')
    expect(parseBody(firstCall as FetchCall)).toMatchObject({
      studyId: STUDY_ID,
      question: 'What is the visit schedule?',
      conversationId: CONVERSATION_ID,
    })
  })

  it('reuses the returned conversationId on the next chat payload', async () => {
    const calls: FetchCall[] = []
    const first = await sendChatQuestion(
      { studyId: STUDY_ID, question: 'First question', conversationId: null },
      makeFetcher(makeChatResponse(CONVERSATION_ID), calls),
    )

    await sendChatQuestion(
      { studyId: STUDY_ID, question: 'Second question', conversationId: first.conversationId },
      makeFetcher(makeChatResponse(CONVERSATION_ID), calls),
    )

    const secondCall = calls.at(1)
    expect(secondCall).toBeDefined()
    expect(parseBody(secondCall as FetchCall).conversationId).toBe(CONVERSATION_ID)
  })

  it('throws a sanitized error when chat fails', async () => {
    const calls: FetchCall[] = []

    await expect(
      sendChatQuestion(
        { studyId: STUDY_ID, question: 'Will this fail?' },
        makeFetcher({ stack: 'internal stack trace' }, calls, 500),
      ),
    ).rejects.toMatchObject({ code: 'request_failed' })
  })

  it('loads history, messages and citations from the Phase 8.1 endpoints', async () => {
    const conversationCalls: FetchCall[] = []
    const messageCalls: FetchCall[] = []
    const citationCalls: FetchCall[] = []

    const conversations = await fetchConversations(
      STUDY_ID,
      makeFetcher(
        {
          conversations: [
            {
              conversationId: CONVERSATION_ID,
              studyId: STUDY_ID,
              title: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
        conversationCalls,
      ),
    )
    const messages = await fetchConversationMessages(
      CONVERSATION_ID,
      makeFetcher(
        {
          conversationId: CONVERSATION_ID,
          studyId: STUDY_ID,
          messages: [
            {
              messageId: MESSAGE_ID,
              role: 'assistant',
              content: 'Answer',
              confidence: 'medium',
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
        messageCalls,
      ),
    )
    const citations = await fetchMessageCitations(
      MESSAGE_ID,
      makeFetcher(
        {
          messageId: MESSAGE_ID,
          citations: [
            {
              citationId: 'citation-1',
              chunkId: 'chunk-1',
              documentId: 'document-1',
              documentVersionId: DOCUMENT_VERSION_ID,
              documentName: 'Protocol',
              documentType: 'protocol',
              pageStart: 7,
              pageEnd: 7,
              sectionTitle: null,
              excerpt: 'Bounded excerpt.',
            },
          ],
        },
        citationCalls,
      ),
    )

    expect(conversations).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(citations).toHaveLength(1)
    expect(conversationCalls.at(0)?.input).toBe(`/api/conversations?studyId=${STUDY_ID}`)
    expect(messageCalls.at(0)?.input).toBe(`/api/conversations/${CONVERSATION_ID}/messages`)
    expect(citationCalls.at(0)?.input).toBe(`/api/citations/${MESSAGE_ID}`)
  })

  it('builds only the authenticated private PDF download endpoint', () => {
    const href = privatePdfDownloadHref(DOCUMENT_VERSION_ID)

    expect(href).toBe(`/api/document-versions/${DOCUMENT_VERSION_ID}/download`)
    expect(href).not.toContain('blob.vercel-storage.com')
    expect(href).not.toContain('blobUrl')
  })
})
