import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Corrida 2 del E2E (2026-10-22): los títulos de conversación salían en inglés
 * ("BMI requirement for admission") porque el prompt de Haiku no fijaba idioma.
 * Contrato: el system prompt debe exigir español explícitamente.
 */
const generateTextMock = vi.hoisted(() => vi.fn())
const runWithLlmFallbackMock = vi.hoisted(() => vi.fn())
const dbUpdateMock = vi.hoisted(() => vi.fn())
const recordUsageMock = vi.hoisted(() => vi.fn())

vi.mock('ai', () => ({ generateText: generateTextMock }))
vi.mock('@ichtys/llm', () => ({ runWithLlmFallback: runWithLlmFallbackMock }))
vi.mock('@ichtys/db', () => ({
  and: vi.fn(),
  db: { update: dbUpdateMock },
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  recordUsage: recordUsageMock,
  auditLogs: {},
  citations: {},
  conversations: {},
  documents: {},
  messages: {},
}))
vi.mock('@ichtys/auth', () => ({
  AccessError: class AccessError extends Error {},
  logServerError: vi.fn(),
}))

const { generateAndPersistConversationTitle } = await import('../persistence')

describe('generateAndPersistConversationTitle — idioma del título', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateTextMock.mockResolvedValue({
      text: 'Criterios de IMC del estudio',
      usage: { promptTokens: 3, completionTokens: 4 },
    })
    runWithLlmFallbackMock.mockImplementation(async (_cfg, runner) => {
      const result = await runner({} as never, 'anthropic', vi.fn(), undefined as never)
      return {
        result,
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        usage: { inputTokens: 3, outputTokens: 4 },
        keySource: 'org',
      }
    })
    dbUpdateMock.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })
    recordUsageMock.mockResolvedValue(undefined)
  })

  it('el system prompt exige español aunque la pregunta esté en inglés', async () => {
    const title = await generateAndPersistConversationTitle({
      conversationId: 'c1',
      question: 'What is the minimum BMI requirement for admission?',
      studyName: 'GZBO',
      orgId: 'org-1',
      studyId: 'study-1',
      userId: 'user-1',
    })

    const system = generateTextMock.mock.calls[0]?.[0]?.system as string
    expect(system).toMatch(/español|spanish/i)

    expect(title).toBe('Criterios de IMC del estudio')
    expect(dbUpdateMock).toHaveBeenCalled()
  })
})
