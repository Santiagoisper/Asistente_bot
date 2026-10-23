import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// Regresión del E2E en vivo 2026-10-22: la org tenía llmProvider="glm", GLM
// fallaba (401/429) y en ai@4 streamText NO lanza — el error va a onError y
// textStream termina vacío. El engine lo convertía en un done
// "insufficient_evidence" silencioso: 20/20 respuestas vacías en producción.
// Estos tests fijan el contrato: una falla del proveedor es un ERROR, nunca
// "evidencia insuficiente".

const mocks = vi.hoisted(() => {
  const mockModel = Symbol('mock-model')
  return {
    mockModel,
    runWithLlmFallback: vi.fn(),
    createLanguageModel: vi.fn().mockReturnValue(mockModel),
    resolveProviderChain: vi.fn().mockReturnValue(['anthropic']),
    isProviderConfigured: vi.fn().mockReturnValue(true),
    getKeySourceForProvider: vi.fn().mockReturnValue('platform'),
    getModelId: vi.fn().mockReturnValue('claude-sonnet-5-5'),
    getDefaultProviderPreference: vi.fn().mockReturnValue('anthropic'),
    isProviderFallbackError: vi.fn().mockReturnValue(false),
    isProviderQuotaError: vi.fn().mockReturnValue(false),
    streamText: vi.fn(),
    generateObject: vi.fn(),
  }
})

vi.mock('@ichtys/llm', () => ({
  ...mocks,
  LlmQuotaExceededError: class LlmQuotaExceededError extends Error {},
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject, streamText: mocks.streamText }))

vi.mock('@ichtys/db', () => ({
  answerConfidence: ['high', 'medium', 'low', 'insufficient_evidence'] as const,
  EMBEDDING_DIMENSIONS: 1536,
  documentType: ['protocol', 'investigator_brochure', 'lab_manual', 'pharmacy_manual', 'soa', 'other'],
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

function makeInput(overrides: Partial<AnswerEngineInput> = {}): AnswerEngineInput {
  return { question: '¿Cuál es el límite de HbA1c?', retrievedChunks: [makeChunk()], ...overrides }
}

/** textStream que termina sin emitir nada — lo que deja ai@4 cuando el fetch falla. */
async function* emptyStream(): AsyncGenerator<string> {}

/** streamText como lo deja ai@4 ante un error del proveedor: onError + stream vacío. */
function streamTextFailingWith(error: unknown): void {
  mocks.streamText.mockImplementation((opts: { onError?: (e: { error: unknown }) => void }) => {
    opts.onError?.({ error })
    return { textStream: emptyStream() }
  })
}

async function collectStream(input: AnswerEngineInput): Promise<{ events: unknown[]; error: unknown }> {
  const events: unknown[] = []
  let error: unknown = null
  try {
    for await (const event of answerEngineStream(input)) events.push(event)
  } catch (err) {
    error = err
  }
  return { events, error }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProviderChain.mockReturnValue(['anthropic'])
  mocks.isProviderConfigured.mockReturnValue(true)
  mocks.getDefaultProviderPreference.mockReturnValue('anthropic')
  mocks.generateObject.mockResolvedValue({ object: { confidence: 'high' } })
  mocks.runWithLlmFallback.mockImplementation(
    async (
      _opts: unknown,
      run: (model: unknown, provider: string, reportUsage: (u: unknown) => void, signal: AbortSignal) => Promise<unknown>,
    ) => ({
      result: await run(mocks.mockModel, 'anthropic', () => {}, new AbortController().signal),
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      usage: { inputTokens: 0, outputTokens: 0 },
      keySource: 'platform',
    }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('answerEngineStream — falla del proveedor ≠ evidencia insuficiente (E2E 2026-10-22)', () => {
  it('proveedor explícito (glm) con error de API: onError + stream vacío → AnswerEngineError, nunca done insufficient_evidence', async () => {
    mocks.resolveProviderChain.mockReturnValue(['glm'])
    streamTextFailingWith(new Error('Z.ai API error (401): invalid api key'))

    const { events, error } = await collectStream(makeInput({ llmProviderPreference: 'glm' }))

    // El bug: done con insufficient_evidence y respuesta vacía. El contrato: error.
    const doneEvents = events.filter((e) => (e as { type: string }).type === 'done')
    expect(doneEvents).toHaveLength(0)
    expect(error).toBeInstanceOf(AnswerEngineError)
    expect((error as AnswerEngineError).code).toBe('provider_unavailable')
    expect((error as AnswerEngineError).message).toContain('GLM')
    expect((error as AnswerEngineError).message).toContain('Ajustes')
  })

  it('preferencia explícita sin clave disponible (nadie intentado) → provider_unavailable con el nombre del proveedor', async () => {
    mocks.resolveProviderChain.mockReturnValue(['glm'])
    mocks.isProviderConfigured.mockReturnValue(false)

    const { events, error } = await collectStream(makeInput({ llmProviderPreference: 'glm' }))

    expect(events.filter((e) => (e as { type: string }).type === 'done')).toHaveLength(0)
    expect(error).toBeInstanceOf(AnswerEngineError)
    expect((error as AnswerEngineError).code).toBe('provider_unavailable')
    expect((error as AnswerEngineError).message).toContain('GLM')
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it('auto: el error del primer proveedor cae al siguiente y responde (no pierde el fallback)', async () => {
    mocks.resolveProviderChain.mockReturnValue(['anthropic', 'openai'])
    // 401 es fallback-able según fallback.ts isProviderFallbackError (línea del
    // status 401/403): la cadena de 'auto' sigue con el proveedor siguiente.
    mocks.isProviderFallbackError.mockReturnValue(true)
    let calls = 0
    mocks.streamText.mockImplementation((opts: { onError?: (e: { error: unknown }) => void }) => {
      calls += 1
      if (calls === 1) {
        opts.onError?.({ error: new Error('API error (401): invalid x-api-key') })
        return { textStream: emptyStream() }
      }
      async function* healthy(): AsyncGenerator<string> { yield 'Plazo de 24 horas [1]' }
      return { textStream: healthy() }
    })

    const { events, error } = await collectStream(makeInput({ llmProviderPreference: 'auto' }))

    expect(error).toBeNull()
    const done = events.find((e) => (e as { type: string }).type === 'done') as { fullAnswer: string } | undefined
    expect(done?.fullAnswer).toBe('Plazo de 24 horas [1]')
  })

  it('happy path: tokens + done con evidencias (regresión)', async () => {
    async function* healthy(): AsyncGenerator<string> { yield 'HbA1c entre 7,0 % y 10,0 % [1]' }
    mocks.streamText.mockReturnValue({ textStream: healthy() })

    const { events, error } = await collectStream(makeInput())

    expect(error).toBeNull()
    const done = events.find((e) => (e as { type: string }).type === 'done') as { confidence: string; evidences: unknown[] } | undefined
    expect(done?.confidence).toBe('high')
    expect(done?.evidences.length).toBeGreaterThan(0)
  })

  it('cadena de 1 con 429 transitorio → llm_rate_limited (saturación), no "proveedor no disponible" (sugerencia reviewer #39)', async () => {
    mocks.resolveProviderChain.mockReturnValue(['anthropic'])
    mocks.isProviderQuotaError.mockReturnValue(true) // el 429 es quota/saturación
    const rateLimited = Object.assign(new Error('API error (429): overloaded'), { status: 429 })
    streamTextFailingWith(rateLimited)

    const { error } = await collectStream(makeInput({ llmProviderPreference: 'anthropic' }))

    expect(error).toBeInstanceOf(AnswerEngineError)
    expect((error as AnswerEngineError).code).toBe('llm_rate_limited')
  })

  it('429 del SDK real (statusCode, sin status ni mensaje 429) también clasifica llm_rate_limited (nota de reviewer #41)', async () => {
    mocks.resolveProviderChain.mockReturnValue(['anthropic'])
    mocks.isProviderQuotaError.mockReturnValue(true)
    // APICallError de ai@4 expone statusCode; mensaje neutro para que solo el
    // statusFromError (statusCode ?? status) pueda clasificar el 429.
    const sdkError = Object.assign(new Error('API error'), { statusCode: 429 })
    streamTextFailingWith(sdkError)

    const { error } = await collectStream(makeInput({ llmProviderPreference: 'anthropic' }))

    expect(error).toBeInstanceOf(AnswerEngineError)
    expect((error as AnswerEngineError).code).toBe('llm_rate_limited')
  })

  it('eval de confianza falla post-stream → fail-open a medium, sin matar la respuesta ya entregada', async () => {
    async function* healthy(): AsyncGenerator<string> { yield 'HbA1c entre 7,0 % y 10,0 % [1]' }
    mocks.streamText.mockReturnValue({ textStream: healthy() })
    mocks.generateObject.mockRejectedValue(new Error('eval provider error'))

    const { events, error } = await collectStream(makeInput())

    expect(error).toBeNull()
    const done = events.find((e) => (e as { type: string }).type === 'done') as { confidence: string } | undefined
    expect(done?.confidence).toBe('medium')
  })
})

describe('sanitize del camino no-streaming: fallback.run "no configurado" → provider_unavailable', () => {
  it('answerEngine con runWithLlmFallback rechazando "Proveedor glm no configurado" mapea a provider_unavailable', async () => {
    mocks.resolveProviderChain.mockReturnValue(['glm'])
    mocks.isProviderConfigured.mockReturnValue(false)
    mocks.runWithLlmFallback.mockRejectedValue(new Error('Proveedor glm no configurado (falta API key en el servidor).'))

    // answerEngine (no-streaming) — import dinámico para reusar los mocks
    const { answerEngine } = await import('../answer-engine')
    await expect(answerEngine(makeInput({ llmProviderPreference: 'glm' }))).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
