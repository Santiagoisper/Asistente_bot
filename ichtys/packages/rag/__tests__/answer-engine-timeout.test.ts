import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mismo patrón de mocks que answer-engine.test.ts: @ichtys/llm parcialmente
// mockeado (loop de proveedores del engine REAL) + 'ai' mockeado.

const mocks = vi.hoisted(() => {
  const mockModel = Symbol('mock-model')
  return {
    mockModel,
    createLanguageModel: vi.fn().mockReturnValue(mockModel),
    resolveProviderChain: vi.fn().mockReturnValue(['anthropic']),
    isProviderConfigured: vi.fn().mockReturnValue(true),
    getKeySourceForProvider: vi.fn().mockReturnValue('platform'),
    getModelId: vi.fn().mockReturnValue('claude-sonnet-5-5'),
    getDefaultProviderPreference: vi.fn().mockReturnValue('anthropic'),
    isProviderFallbackError: vi.fn().mockReturnValue(false),
    streamText: vi.fn(),
    generateObject: vi.fn(),
  }
})

vi.mock('@ichtys/llm', () => ({
  runWithLlmFallback: vi.fn(
    async (
      _opts: unknown,
      run: (model: unknown, provider: string, reportUsage: (u: unknown) => void) => Promise<unknown>,
    ) => ({
      result: await run(mocks.mockModel, 'anthropic', () => {}),
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      usage: { inputTokens: 0, outputTokens: 0 },
      keySource: 'platform',
    }),
  ),
  createLanguageModel: mocks.createLanguageModel,
  getDefaultProviderPreference: mocks.getDefaultProviderPreference,
  getModelId: mocks.getModelId,
  getKeySourceForProvider: mocks.getKeySourceForProvider,
  resolveProviderChain: mocks.resolveProviderChain,
  isProviderConfigured: mocks.isProviderConfigured,
  isProviderFallbackError: mocks.isProviderFallbackError,
  LlmQuotaExceededError: class LlmQuotaExceededError extends Error {},
}))

vi.mock('ai', () => ({ generateObject: mocks.generateObject, streamText: mocks.streamText }))

vi.mock('@ichtys/db', () => ({
  answerConfidence: ['high', 'medium', 'low', 'insufficient_evidence'] as const,
  EMBEDDING_DIMENSIONS: 1536,
  documentType: ['protocol', 'investigator_brochure', 'lab_manual', 'pharmacy_manual', 'other'],
  chunks: {},
  db: { select: vi.fn() },
}))

vi.mock('@ichtys/ingestion/embedder', () => ({
  EmbeddingError: class EmbeddingError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  },
  embedQuery: vi.fn(),
}))

import { answerEngineStream, AnswerEngineError } from '../answer-engine'
import type { AnswerEngineInput } from '../answer-engine'
import type { RetrievedChunk } from '../retriever'

function makeChunk(): RetrievedChunk {
  return {
    chunkId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentVersionId: crypto.randomUUID(),
    documentType: 'protocol',
    pageStart: 2,
    pageEnd: 4,
    sectionTitle: 'Eligibility Criteria',
    content: 'Patients must have HbA1c >= 7.0% and < 10.0% at screening visit.',
    similarityScore: 0.92,
  }
}

function makeInput(): AnswerEngineInput {
  return { question: 'What are the HbA1c criteria?', retrievedChunks: [makeChunk()] }
}

/** Nunca emite ni termina: el caso de los 43 timeouts de 300 s en producción. */
function hangForever(): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      return { next: (): Promise<IteratorResult<string>> => new Promise(() => {}) }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProviderChain.mockReturnValue(['anthropic'])
  mocks.isProviderConfigured.mockReturnValue(true)
  mocks.getDefaultProviderPreference.mockReturnValue('anthropic')
  mocks.generateObject.mockResolvedValue({ object: { confidence: 'high' } })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('answerEngineStream — timeout propio (nunca el corte de 300 s de Vercel)', () => {
  it('si el primer token no llega a tiempo → AnswerEngineError llm_timeout', async () => {
    vi.stubEnv('LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS', '60')
    mocks.streamText.mockReturnValue({ textStream: hangForever() })

    const events: unknown[] = []
    await expect(async () => {
      for await (const event of answerEngineStream(makeInput())) events.push(event)
    }).rejects.toMatchObject({ code: 'llm_timeout' })
    expect(events.filter((e) => (e as { type: string }).type === 'token')).toHaveLength(0)
  }, 10_000)

  it('si el stream se queda mudo entre tokens → llm_timeout (los tokens ya emitidos no se repiten)', async () => {
    vi.stubEnv('LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS', '5000')
    vi.stubEnv('LLM_STREAM_IDLE_TIMEOUT_MS', '60')
    async function* stallsAfterFirst(): AsyncGenerator<string> {
      yield 'Plazo de '
      await new Promise(() => {}) // mudo para siempre
    }
    mocks.streamText.mockReturnValue({ textStream: stallsAfterFirst() })

    const events: unknown[] = []
    await expect(async () => {
      for await (const event of answerEngineStream(makeInput())) events.push(event)
    }).rejects.toMatchObject({ code: 'llm_timeout' })
    const tokens = events.filter((e) => (e as { type: string }).type === 'token')
    expect(tokens).toHaveLength(1)
  }, 10_000)

  it('timeout del primer proveedor → cae al siguiente de la cadena y responde', async () => {
    vi.stubEnv('LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS', '60')
    mocks.resolveProviderChain.mockReturnValue(['glm', 'anthropic'])
    mocks.getDefaultProviderPreference.mockReturnValue('glm')
    async function* healthyStream(): AsyncGenerator<string> {
      yield 'Plazo de 24 horas [1]'
    }
    mocks.streamText
      .mockReturnValueOnce({ textStream: hangForever() }) // glm cuelga
      .mockReturnValueOnce({ textStream: healthyStream() }) // anthropic responde

    const events: Array<{ type: string; text?: string }> = []
    for await (const event of answerEngineStream(makeInput())) events.push(event)

    const text = events.filter((e) => e.type === 'token').map((e) => e.text).join('')
    expect(text).toContain('Plazo de 24 horas')
    expect(mocks.streamText).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('el evento done informa proveedor/modelo/latencia para los logs del route', async () => {
    async function* healthyStream(): AsyncGenerator<string> {
      yield 'ok [1]'
    }
    mocks.streamText.mockReturnValue({ textStream: healthyStream() })

    const events: Array<{ type: string; timing?: { provider: string; modelId: string; firstTokenMs: number; totalMs: number } }> = []
    for await (const event of answerEngineStream(makeInput())) events.push(event)

    const done = events.find((e) => e.type === 'done')
    expect(done?.timing).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-5-5' })
    expect(done?.timing?.firstTokenMs).toBeGreaterThanOrEqual(0)
    expect(done?.timing?.totalMs).toBeGreaterThanOrEqual(done!.timing!.firstTokenMs)
  })

  it('stream sano no se ve afectado por los timeouts (regresión)', async () => {
    vi.stubEnv('LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS', '5000')
    vi.stubEnv('LLM_STREAM_IDLE_TIMEOUT_MS', '5000')
    async function* healthyStream(): AsyncGenerator<string> {
      yield 'Plazo de '
      yield '24 horas [1]'
    }
    mocks.streamText.mockReturnValue({ textStream: healthyStream() })

    const events: Array<{ type: string; text?: string }> = []
    for await (const event of answerEngineStream(makeInput())) events.push(event)

    expect(events.filter((e) => e.type === 'token').map((e) => e.text).join('')).toContain('Plazo de 24 horas')
    expect(events.at(-1)?.type).toBe('done')
  })

  it('llm_timeout es un código distinto de llm_provider_error (mensaje claro al usuario)', async () => {
    vi.stubEnv('LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS', '60')
    mocks.streamText.mockReturnValue({ textStream: hangForever() })

    let thrown: unknown
    try {
      for await (const _event of answerEngineStream(makeInput())) { /* consume */ }
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(AnswerEngineError)
    expect((thrown as AnswerEngineError).code).toBe('llm_timeout')
    expect((thrown as AnswerEngineError).message).toMatch(/timed out/i)
  }, 10_000)
})
