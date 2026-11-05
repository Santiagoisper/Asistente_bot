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
  mocks.generateObject.mockResolvedValue({
    object: { confidence: 'high' },
    // Paso 1 (A7): usage con el shape de ai 7 — lo reporta el eval de confianza.
    usage: { inputTokens: 3, outputTokens: 2 },
  })
  mocks.runWithLlmFallback.mockImplementation(
    async (
      _opts: unknown,
      run: (
        model: unknown,
        provider: string,
        reportUsage: (u: { inputTokens: number; outputTokens: number }) => void,
        signal: AbortSignal,
      ) => Promise<unknown>,
    ) => {
      // Paso 1 (A7): acumulador real, como el fallback de producción.
      const usage = { inputTokens: 0, outputTokens: 0 }
      const result = await run(mocks.mockModel, 'anthropic', (u) => {
        usage.inputTokens += u.inputTokens
        usage.outputTokens += u.outputTokens
      }, new AbortController().signal)
      return {
        result,
        provider: 'anthropic',
        modelId: 'claude-sonnet-5-5',
        usage,
        keySource: 'platform',
      }
    },
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

  it('happy path: usageEvents con inputTokens > 0 para chat_answer y chat_eval (A7)', async () => {
    async function* healthy(): AsyncGenerator<string> { yield 'HbA1c entre 7,0 % y 10,0 % [1]' }
    // Usage del stream con el shape de ai 7 (usage es una promesa en el result).
    mocks.streamText.mockReturnValue({
      textStream: healthy(),
      usage: Promise.resolve({ inputTokens: 21, outputTokens: 34 }),
    })

    const { events, error } = await collectStream(makeInput())

    expect(error).toBeNull()
    const done = events.find((e) => (e as { type: string }).type === 'done') as
      | { usageEvents?: Array<{ kind: string; inputTokens: number; outputTokens: number }> }
      | undefined
    const answerEvent = done?.usageEvents?.find((e) => e.kind === 'chat_answer')
    const evalEvent = done?.usageEvents?.find((e) => e.kind === 'chat_eval')
    // El stream renombró promptTokens→inputTokens y el eval completionTokens→
    // outputTokens: ambos tienen que llegar > 0 para que recordUsage facture.
    expect(answerEvent?.inputTokens).toBe(21)
    expect(answerEvent?.outputTokens).toBe(34)
    expect(evalEvent?.inputTokens).toBe(3)
    expect(evalEvent?.outputTokens).toBe(2)
  })

  it('streamText con temperature 0 — ai@4 lo inyectaba por defecto, ai@7 no (R1, B3)', async () => {
    async function* healthy(): AsyncGenerator<string> { yield 'HbA1c entre 7,0 % y 10,0 % [1]' }
    mocks.streamText.mockReturnValue({ textStream: healthy() })

    await collectStream(makeInput())

    // En ai@4.3.19 prepareCallSettings inyectaba temperature 0; ai@7 no tiene
    // default. El paso 1 conserva el comportamiento medido: 0 explícito.
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 })
    )
  })

  it('kit ai 7: AICallError (statusCode 500) vía onError + stream vacío sigue siendo provider_unavailable, nunca insufficient_evidence (A7)', async () => {
    mocks.resolveProviderChain.mockReturnValue(['anthropic'])
    // Forma del error que levanta el kit nuevo: AICallError con statusCode y
    // url, mensaje neutro (sin texto clínico).
    const ai7Error = Object.assign(new Error('API error'), {
      name: 'AICallError',
      statusCode: 500,
      url: 'https://api.anthropic.com/v1/messages',
      isRetryable: true,
    })
    streamTextFailingWith(ai7Error)

    const { events, error } = await collectStream(makeInput({ llmProviderPreference: 'anthropic' }))

    // El contrato que no puede romperse con el kit nuevo (E2E 2026-10-22):
    // fallo de proveedor = ERROR, jamás un done "insufficient_evidence".
    expect(events.filter((e) => (e as { type: string }).type === 'done')).toHaveLength(0)
    expect(error).toBeInstanceOf(AnswerEngineError)
    expect((error as AnswerEngineError).code).toBe('provider_unavailable')
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

const PROVIDER_SENTINEL = 'sk-ant-provider-raw-ficticio-NO-LOG'

function flattenLogValue(value: unknown): string {
  if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ''}`
  if (Array.isArray(value)) return value.map(flattenLogValue).join(' ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => args.map(flattenLogValue).join(' ')).join('\n')
}

describe('answerEngineStream — S8 el log no lleva el mensaje del proveedor', () => {
  it('el fallo final no imprime el objeto ni el mensaje crudo', async () => {
    mocks.resolveProviderChain.mockReturnValue(['glm'])
    streamTextFailingWith(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { error } = await collectStream(makeInput({ llmProviderPreference: 'glm' }))
      const logged = loggedText(spy)

      expect(error).toBeInstanceOf(AnswerEngineError)
      expect((error as AnswerEngineError).message).not.toContain(PROVIDER_SENTINEL)
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('llm_provider_error')
    } finally {
      spy.mockRestore()
    }
  })

  it('el reintento con otro proveedor no copia el mensaje crudo', async () => {
    mocks.resolveProviderChain.mockReturnValue(['anthropic', 'openai'])
    mocks.isProviderFallbackError.mockReturnValue(true)
    let calls = 0
    mocks.streamText.mockImplementation((opts: { onError?: (e: { error: unknown }) => void }) => {
      calls += 1
      if (calls === 1) {
        opts.onError?.({ error: new Error(PROVIDER_SENTINEL) })
        return { textStream: emptyStream() }
      }
      async function* healthy(): AsyncGenerator<string> { yield 'Linea ficticia del protocolo [1]' }
      return { textStream: healthy() }
    })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const { error } = await collectStream(makeInput({ llmProviderPreference: 'auto' }))
      const logged = loggedText(spy)

      expect(error).toBeNull()
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('provider_failed')
    } finally {
      spy.mockRestore()
    }
  })

  it('la evaluación de confianza no imprime el error del proveedor', async () => {
    async function* healthy(): AsyncGenerator<string> { yield 'Linea ficticia del protocolo [1]' }
    mocks.streamText.mockReturnValue({ textStream: healthy() })
    mocks.generateObject.mockRejectedValue(new Error(PROVIDER_SENTINEL))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const { error } = await collectStream(makeInput())
      const logged = loggedText(spy)

      expect(error).toBeNull()
      expect(logged).not.toContain(PROVIDER_SENTINEL)
      expect(logged).toContain('confidence_eval_failed')
    } finally {
      spy.mockRestore()
    }
  })
})
