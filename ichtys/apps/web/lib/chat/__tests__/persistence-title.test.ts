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
      // Paso 1 (A7): usage con el shape de ai 7 (inputTokens/outputTokens).
      usage: { inputTokens: 3, outputTokens: 4 },
    })
    runWithLlmFallbackMock.mockImplementation(async (_cfg, runner) => {
      // Paso 1 (A7): acumulador real — el total que reporta el runner es el
      // que llega a recordUsage (antes estaba hardcodeado).
      const usage = { inputTokens: 0, outputTokens: 0 }
      const reportUsage = (u: { inputTokens: number; outputTokens: number }) => {
        usage.inputTokens += u.inputTokens
        usage.outputTokens += u.outputTokens
      }
      const result = await runner({} as never, 'anthropic', reportUsage, undefined as never)
      return {
        result,
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        usage,
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

    // Paso 1 (A7): el prompt de sistema viaja como `instructions` (ai 7).
    const instructions = generateTextMock.mock.calls[0]?.[0]?.instructions as string
    expect(instructions).toMatch(/español|spanish/i)

    expect(title).toBe('Criterios de IMC del estudio')
    expect(dbUpdateMock).toHaveBeenCalled()
  })
})
