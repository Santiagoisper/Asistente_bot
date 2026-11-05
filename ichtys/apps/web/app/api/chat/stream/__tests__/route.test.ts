import { beforeEach, describe, expect, it, vi } from 'vitest'

const PROVIDER_SENTINEL = 'sk-ant-provider-raw-ficticio-NO-LOG'
const STUDY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const mocks = vi.hoisted(() => ({
  validateStudyAccess: vi.fn(),
  handleApiError: vi.fn((err: unknown) => {
    if (err instanceof Error && err.name === 'AccessError') {
      return new Response('Forbidden', { status: 403 })
    }
    return new Response('Internal Server Error', { status: 500 })
  }),
  getOrgRagConfig: vi.fn(),
  getOrgLlmApiKeys: vi.fn(),
  getQuotaStatus: vi.fn(),
  recordUsage: vi.fn(),
  retrieveRelevantChunks: vi.fn(),
  answerEngineStream: vi.fn(),
  getOrCreateConversation: vi.fn(),
  loadConversationHistory: vi.fn(),
  persistUserMessage: vi.fn(),
  persistAssistantMessageAndCitations: vi.fn(),
  writeAuditLog: vi.fn(),
  generateAndPersistConversationTitle: vi.fn(),
  enforceSlidingWindowRateLimit: vi.fn(),
  getSpecContextChunks: vi.fn(),
}))

vi.mock('@ichtys/auth', () => ({
  validateStudyAccess: mocks.validateStudyAccess,
  handleApiError: mocks.handleApiError,
}))

vi.mock('@ichtys/db', () => ({
  canUsePlatformKey: (status: { state: string } | null) => status?.state !== 'exceeded',
  getOrgLlmApiKeys: mocks.getOrgLlmApiKeys,
  getOrgRagConfig: mocks.getOrgRagConfig,
  getQuotaStatus: mocks.getQuotaStatus,
  recordUsage: mocks.recordUsage,
  resolveLlmApiKey: () => undefined,
}))

vi.mock('@ichtys/rag', () => {
  class AnswerEngineError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'AnswerEngineError'
    }
  }
  return {
    AnswerEngineError,
    retrieveRelevantChunks: mocks.retrieveRelevantChunks,
    answerEngineStream: mocks.answerEngineStream,
  }
})

vi.mock('@ichtys/rag/medical-annotator', () => ({
  annotateAnswerSync: () => [],
}))

vi.mock('@ichtys/rag/terminology-answer', () => ({
  buildTerminologyAnswer: () => ({
    answer: '',
    confidence: 'insufficient_evidence',
    terminologySuggestions: [],
    protocolMentionsFound: false,
  }),
}))

vi.mock('../../../../../lib/chat/persistence', () => ({
  generateAndPersistConversationTitle: mocks.generateAndPersistConversationTitle,
  getOrCreateConversation: mocks.getOrCreateConversation,
  loadConversationHistory: mocks.loadConversationHistory,
  persistUserMessage: mocks.persistUserMessage,
  persistAssistantMessageAndCitations: mocks.persistAssistantMessageAndCitations,
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock('../../../../../lib/security/rate-limit', () => ({
  enforceSlidingWindowRateLimit: mocks.enforceSlidingWindowRateLimit,
  getChatRateLimitConfig: () => ({ limit: 30, orgLimit: 120, windowSeconds: 60 }),
  rateLimitResponse: () => new Response('Too Many Requests', { status: 429 }),
  rateLimitUnavailableResponse: () =>
    Response.json(
      { error: 'rate_limit_unavailable', message: 'No se pudo verificar el cupo. Probá de nuevo en unos minutos.' },
      { status: 503, headers: { 'Retry-After': '60' } },
    ),
}))

vi.mock('../../../../../lib/rag/query-expander', () => ({
  expandShortQueryForRetrieval: ({ question }: { question: string }) => question,
}))

vi.mock('../../../../../lib/rag/spec-context', () => ({
  getSpecContextChunks: mocks.getSpecContextChunks,
}))

vi.mock('../../../../../lib/rag/terminology-intent', () => ({
  detectTerminologyIntent: () => ({ isTerminologyQuery: false, suggestions: [] }),
}))

vi.mock('../../../../../lib/observability/logger', () => ({
  getOrCreateRequestId: () => 'req-ficticio',
  log: vi.fn(),
  makeRecord: (record: unknown) => record,
}))

import { POST } from '../route'

function flattenLogValue(value: unknown): string {
  if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ''}`
  if (Array.isArray(value)) return value.map(flattenLogValue).join(' ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => args.map(flattenLogValue).join(' ')).join('\n')
}

function streamRequest(): Request {
  return new Request('http://localhost/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyId: STUDY_ID, question: 'criterio ficticio de inclusion' }),
  })
}

async function* doneStream(): AsyncGenerator<Record<string, unknown>> {
  yield {
    type: 'done',
    confidence: 'insufficient_evidence',
    evidences: [],
    fullAnswer: '',
    usageEvents: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateStudyAccess.mockResolvedValue({
    userId: 'user_ficticio',
    orgId: 'org_ficticia',
    study: { id: STUDY_ID, name: 'Estudio ficticio', protocolNumber: 'FIC-001' },
  })
  mocks.enforceSlidingWindowRateLimit.mockResolvedValue({ limited: false })
  mocks.getOrCreateConversation.mockResolvedValue('conv-ficticia')
  mocks.loadConversationHistory.mockResolvedValue([])
  mocks.persistUserMessage.mockResolvedValue('msg-ficticio')
  mocks.persistAssistantMessageAndCitations.mockResolvedValue('asst-ficticio')
  mocks.writeAuditLog.mockResolvedValue(undefined)
  mocks.generateAndPersistConversationTitle.mockResolvedValue(null)
  mocks.getOrgRagConfig.mockResolvedValue({ topK: 8, similarityThreshold: 0.2, llmProvider: 'anthropic' })
  mocks.getOrgLlmApiKeys.mockResolvedValue({})
  mocks.getQuotaStatus.mockResolvedValue({ state: 'ok' })
  mocks.recordUsage.mockResolvedValue(undefined)
  mocks.getSpecContextChunks.mockResolvedValue({ chunks: [], specFound: false })
  mocks.retrieveRelevantChunks.mockResolvedValue([])
  mocks.answerEngineStream.mockImplementation(() => doneStream())
})

describe('POST /api/chat/stream — cupo', () => {
  it('responde 503 y no abre el stream si no se puede verificar el cupo', async () => {
    mocks.enforceSlidingWindowRateLimit.mockResolvedValueOnce({
      limited: true,
      retryAfterSeconds: 60,
      reason: 'unavailable',
    })

    const res = await POST(streamRequest())

    expect(res.status).toBe(503)
    expect(mocks.answerEngineStream).not.toHaveBeenCalled()
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled()
  })
})

describe('POST /api/chat/stream — S8 mensaje crudo', () => {
  it('getOrgRagConfig no deja el error crudo en el log', async () => {
    mocks.getOrgRagConfig.mockRejectedValue(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const res = await POST(streamRequest())
      await res.text()
      const logged = loggedText(spy)

      expect(res.status).toBe(200)
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('rag_config_unavailable')
    } finally {
      spy.mockRestore()
    }
  })

  it('getOrgLlmApiKeys no deja el error crudo en el log', async () => {
    mocks.getOrgLlmApiKeys.mockRejectedValue(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const res = await POST(streamRequest())
      await res.text()
      const logged = loggedText(spy)

      expect(res.status).toBe(200)
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('llm_keys_unavailable')
    } finally {
      spy.mockRestore()
    }
  })

  it('getQuotaStatus no deja el error crudo en el log', async () => {
    mocks.getQuotaStatus.mockRejectedValue(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const res = await POST(streamRequest())
      await res.text()
      const logged = loggedText(spy)

      expect(res.status).toBe(200)
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('quota_lookup_failed')
    } finally {
      spy.mockRestore()
    }
  })

  it('el fallo del stream no deja el error crudo en el log ni en el frame', async () => {
    mocks.retrieveRelevantChunks.mockRejectedValue(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const res = await POST(streamRequest())
      const body = await res.text()
      const logged = loggedText(spy)

      expect(res.status).toBe(200)
      expect(body).not.toContain(PROVIDER_SENTINEL)
      expect(body).toContain('internal_error')
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('stream_failed')
    } finally {
      spy.mockRestore()
    }
  })
})
