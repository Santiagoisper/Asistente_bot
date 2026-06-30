import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted — deben declararse antes de cualquier import del módulo bajo prueba.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockModel = Symbol('mock-anthropic-model')
  const anthropicProviderFn = vi.fn().mockReturnValue(mockModel)
  const createAnthropicFn = vi.fn().mockReturnValue(anthropicProviderFn)
  const generateObjectFn = vi.fn()
  const streamTextFn = vi.fn()

  return {
    mockModel,
    anthropicProviderFn,
    createAnthropic: createAnthropicFn,
    generateObject: generateObjectFn,
    streamText: streamTextFn,
  }
})

vi.mock('@ichtys/llm', () => ({
  runWithLlmFallback: vi.fn(async (_opts: unknown, run: (model: unknown) => Promise<unknown>) => ({
    result: await run(mocks.mockModel),
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
  })),
  createLanguageModel: vi.fn().mockReturnValue(mocks.mockModel),
  getDefaultProviderPreference: vi.fn().mockReturnValue('auto'),
  resolveProviderChain: vi.fn().mockReturnValue(['anthropic']),
  isProviderConfigured: vi.fn().mockReturnValue(true),
  isProviderFallbackError: vi.fn().mockReturnValue(false),
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject, streamText: mocks.streamText }))

// @ichtys/db: mock para evitar que el cliente DB tire error por DATABASE_URL faltante.
// Se proveen todos los valores que answer-engine.ts y retriever.ts necesitan.
vi.mock('@ichtys/db', () => ({
  answerConfidence: ['high', 'medium', 'low', 'insufficient_evidence'] as const,
  EMBEDDING_DIMENSIONS: 1536,
  documentType: ['protocol', 'investigator_brochure', 'lab_manual', 'pharmacy_manual', 'other'],
  chunks: {},
  db: { select: vi.fn() },
}))

// @ichtys/ingestion/embedder: mock para cortar la cadena de dependencias del retriever.
vi.mock('@ichtys/ingestion/embedder', () => ({
  EmbeddingError: class EmbeddingError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  },
  embedQuery: vi.fn(),
}))

// guardrails NO se mockea — corre real para probar la integración con los guardrails.

// ---------------------------------------------------------------------------
// Imports post-mock
// ---------------------------------------------------------------------------

import {
  answerEngine,
  answerEngineStream,
  AnswerEngineError,
  EXCERPT_MAX_CHARS,
  HISTORY_TURN_MAX_CHARS,
  MAX_HISTORY_TURNS,
  SYSTEM_PROMPT,
  truncateExcerpt,
  extractCitationIndicesFromAnswer,
  buildContext,
  buildHistoryBlock,
} from '../answer-engine'
import type { AnswerEngineInput, ConversationTurn } from '../answer-engine'
import type { RetrievedChunk } from '../retriever'
import {
  MIN_SIMILARITY_THRESHOLD,
  detectQuestionLanguage,
  getInsufficientEvidenceMessage,
  INSUFFICIENT_EVIDENCE_MESSAGES,
} from '../guardrails'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentVersionId: crypto.randomUUID(),
    documentType: 'protocol',
    pageStart: 2,
    pageEnd: 4,
    sectionTitle: 'Eligibility Criteria',
    content: 'Patients must have HbA1c >= 7.0% and < 10.0% at screening visit.',
    similarityScore: 0.90,
    ...overrides,
  }
}

function makeLLMResponse(overrides: {
  answer?: string
  confidence?: 'high' | 'medium' | 'low' | 'insufficient_evidence'
  citationIndices?: number[]
}) {
  return {
    object: {
      answer: overrides.answer ?? 'HbA1c must be between 7.0% and 10.0%.',
      confidence: overrides.confidence ?? 'high',
      citationIndices: overrides.citationIndices ?? [1],
    },
  }
}

function makeInput(chunks: RetrievedChunk[], question = 'What are the HbA1c criteria?'): AnswerEngineInput {
  return { question, retrievedChunks: chunks }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// truncateExcerpt
// ---------------------------------------------------------------------------

describe('truncateExcerpt', () => {
  it('returns content as-is when shorter than maxChars', () => {
    const short = 'Short text.'
    expect(truncateExcerpt(short)).toBe(short)
  })

  it('truncates at word boundary and appends ellipsis when content exceeds maxChars', () => {
    const long = 'word '.repeat(200) // >> 600 chars
    const result = truncateExcerpt(long)
    expect(result.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS + 1) // +1 for '…'
    expect(result.endsWith('…')).toBe(true)
    // The char immediately after the truncation point in the original must be a space
    // (proof that we cut at a word boundary, not mid-word)
    const truncatedPart = result.slice(0, -1) // strip '…'
    expect(long[truncatedPart.length]).toBe(' ')
  })

  it('truncates at exactly maxChars if no space is found', () => {
    const noSpaces = 'x'.repeat(EXCERPT_MAX_CHARS + 50)
    const result = truncateExcerpt(noSpaces)
    expect(result).toBe('x'.repeat(EXCERPT_MAX_CHARS) + '…')
  })
})

// ---------------------------------------------------------------------------
// Fallback: sin chunks
// ---------------------------------------------------------------------------

describe('answerEngine — insufficient_evidence fallback', () => {
  it('returns insufficient_evidence with empty evidences when retrievedChunks is empty', async () => {
    const result = await answerEngine(makeInput([]))

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.evidences).toEqual([])
    expect(result.answer).toBeTruthy()
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('returns insufficient_evidence when all chunks are below the similarity threshold', async () => {
    const belowThreshold = makeChunk({ similarityScore: MIN_SIMILARITY_THRESHOLD - 0.01 })
    const result = await answerEngine(makeInput([belowThreshold]))

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.evidences).toEqual([])
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('returns insufficient_evidence when LLM itself reports insufficient evidence', async () => {
    const chunk = makeChunk({ similarityScore: 0.85 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'insufficient_evidence', citationIndices: [] })
    )

    const result = await answerEngine(makeInput([chunk]))

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.evidences).toEqual([])
  })

  it('degrades to insufficient_evidence when LLM returns high confidence but empty citationIndices', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [] })
    )

    const result = await answerEngine(makeInput([chunk]))

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.evidences).toEqual([])
  })

  it('degrades to insufficient_evidence when all citationIndices are out of bounds', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    // Only 1 chunk, but LLM claims to cite [5], [9] — hallucinated indices
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [5, 9] })
    )

    const result = await answerEngine(makeInput([chunk]))

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.evidences).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Respuestas con evidencia
// ---------------------------------------------------------------------------

describe('answerEngine — responses with evidence', () => {
  it('returns high confidence with evidences when 3+ chunks above 0.85', async () => {
    const chunks = [
      makeChunk({ similarityScore: 0.92 }),
      makeChunk({ similarityScore: 0.89 }),
      makeChunk({ similarityScore: 0.86 }),
    ]
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1, 2, 3] })
    )

    const result = await answerEngine(makeInput(chunks))

    expect(result.confidence).toBe('high')
    expect(result.evidences).toHaveLength(3)
  })

  it('returns medium confidence with evidences', async () => {
    const chunks = [makeChunk({ similarityScore: 0.82 })]
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'medium', citationIndices: [1] })
    )

    const result = await answerEngine(makeInput(chunks))

    expect(result.confidence).toBe('medium')
    expect(result.evidences).toHaveLength(1)
  })

  it('returns low confidence with evidences', async () => {
    const chunks = [makeChunk({ similarityScore: 0.77 })]
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'low', citationIndices: [1] })
    )

    const result = await answerEngine(makeInput(chunks))

    expect(result.confidence).toBe('low')
    expect(result.evidences).toHaveLength(1)
  })

  it('never returns a useful answer (high/medium/low) without evidences', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1] })
    )

    const result = await answerEngine(makeInput([chunk]))

    if (result.confidence !== 'insufficient_evidence') {
      expect(result.evidences.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Integridad de las evidencias
// ---------------------------------------------------------------------------

describe('answerEngine — evidence integrity', () => {
  it('derives evidences from the actual chunks received, not invented metadata', async () => {
    const chunk = makeChunk({
      chunkId: 'chunk-abc',
      documentId: 'doc-xyz',
      documentVersionId: 'ver-123',
      pageStart: 7,
      pageEnd: 9,
      sectionTitle: 'Inclusion Criteria',
      similarityScore: 0.88,
    })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1] })
    )

    const result = await answerEngine(makeInput([chunk]))

    expect(result.evidences).toHaveLength(1)
    const evidence = result.evidences[0]!
    expect(evidence.chunkId).toBe('chunk-abc')
    expect(evidence.documentId).toBe('doc-xyz')
    expect(evidence.documentVersionId).toBe('ver-123')
    expect(evidence.pageStart).toBe(7)
    expect(evidence.pageEnd).toBe(9)
    expect(evidence.sectionTitle).toBe('Inclusion Criteria')
  })

  it('does not invent documentId, documentVersionId, pageStart or pageEnd', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1] })
    )

    const result = await answerEngine(makeInput([chunk]))

    const evidence = result.evidences[0]!
    expect(evidence.documentId).toBe(chunk.documentId)
    expect(evidence.documentVersionId).toBe(chunk.documentVersionId)
    expect(evidence.pageStart).toBe(chunk.pageStart)
    expect(evidence.pageEnd).toBe(chunk.pageEnd)
  })

  it('deduplicates evidences when citationIndices contains repeated chunk references', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1, 1, 1] })
    )

    const result = await answerEngine(makeInput([chunk]))

    expect(result.evidences).toHaveLength(1)
  })

  it('skips out-of-bounds citationIndices silently and uses valid ones', async () => {
    const chunks = [makeChunk({ similarityScore: 0.90 }), makeChunk({ similarityScore: 0.85 })]
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'medium', citationIndices: [1, 99, 2] })
    )

    const result = await answerEngine(makeInput(chunks))

    // Index 99 is out of bounds (only 2 chunks) — should be ignored
    expect(result.evidences).toHaveLength(2)
    expect(result.evidences[0]!.chunkId).toBe(chunks[0]!.chunkId)
    expect(result.evidences[1]!.chunkId).toBe(chunks[1]!.chunkId)
  })
})

// ---------------------------------------------------------------------------
// Excerpts
// ---------------------------------------------------------------------------

describe('answerEngine — excerpt handling', () => {
  it('excerpt is not the full chunk content when chunk is longer than EXCERPT_MAX_CHARS', async () => {
    const longContent = 'clinical data '.repeat(100) // >> 600 chars
    const chunk = makeChunk({ content: longContent, similarityScore: 0.90 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1] })
    )

    const result = await answerEngine(makeInput([chunk]))

    const excerpt = result.evidences[0]!.excerpt
    expect(excerpt.length).toBeLessThan(longContent.length)
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS + 1)
    expect(excerpt).not.toBe(longContent)
  })

  it('excerpt equals full content when chunk is within the limit', async () => {
    const shortContent = 'HbA1c must be >= 7.0% at screening.'
    const chunk = makeChunk({ content: shortContent, similarityScore: 0.90 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1] })
    )

    const result = await answerEngine(makeInput([chunk]))

    expect(result.evidences[0]!.excerpt).toBe(shortContent)
  })

  it('centers the excerpt on the chunk fragment relevant to the question/answer', async () => {
    // Reproduce el caso reportado: chunk multi-página cuyo INICIO es texto no
    // relacionado (anticuerpos) y cuyo pasaje relevante (timeline de SAE) está
    // en el medio. El excerpt debe centrarse en el pasaje relevante.
    // Prefijo no relacionado lo bastante largo (>EXCERPT_MAX_CHARS) como para que
    // el enfoque anterior (primeros 600 chars) NO incluyera el pasaje del SAE.
    const irrelevant = 'Se analizaran las muestras de suero para detectar anticuerpos anti-pegozafermina. '.repeat(12)
    const relevant =
      'El evento adverso serio debe notificarse a 89bio dentro de las 24 horas desde que se toma conocimiento, hasta 28 dias despues de la ultima dosis. '
    const trailing = 'Procedimientos medicos como endoscopia o apendicectomia se registran aparte. '.repeat(8)
    const content = irrelevant + relevant + trailing
    const chunk = makeChunk({ content, similarityScore: 0.9 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({
        answer:
          'El SAE debe notificarse dentro de las 24 horas, hasta 28 dias despues de la ultima dosis [1].',
        confidence: 'high',
        citationIndices: [1],
      })
    )

    const result = await answerEngine(
      makeInput([chunk], 'cual es el timeline del reporte de un SAE?')
    )

    const excerpt = result.evidences[0]!.excerpt
    // El prefijo de 600 chars NO contiene el pasaje del SAE; el excerpt relevante sí.
    expect(truncateExcerpt(content)).not.toContain('24 horas')
    expect(excerpt).toContain('24 horas')
    expect(excerpt).toContain('89bio')
  })
})

// ---------------------------------------------------------------------------
// Prompt-injection guard
// ---------------------------------------------------------------------------

describe('answerEngine — prompt-injection guard', () => {
  it('calls the LLM with a system prompt that forbids following instructions in document content', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1] })
    )

    await answerEngine(makeInput([chunk], 'What is the SAE reporting timeline?'))

    expect(mocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: SYSTEM_PROMPT,
      })
    )
    expect(SYSTEM_PROMPT).toMatch(/ignore.*instruction/i)
  })

  it('system prompt instructs the LLM to respond in the same language as the question', () => {
    expect(SYSTEM_PROMPT).toMatch(/same language as the question/i)
  })
})

// ---------------------------------------------------------------------------
// Idioma
// ---------------------------------------------------------------------------

describe('answerEngine — language', () => {
  it('passes the question text to the LLM prompt without modification', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    const spanishQuestion = '¿Cuál es el criterio de HbA1c para inclusión?'
    mocks.generateObject.mockResolvedValueOnce(
      makeLLMResponse({ confidence: 'high', citationIndices: [1] })
    )

    await answerEngine(makeInput([chunk], spanishQuestion))

    const callArgs = mocks.generateObject.mock.calls[0]![0] as { prompt: string }
    expect(callArgs.prompt).toContain(spanishQuestion)
  })
})

// ---------------------------------------------------------------------------
// LLM error sanitization
// ---------------------------------------------------------------------------

describe('answerEngine — LLM error sanitization', () => {
  it('throws AnswerEngineError with llm_provider_error when LLM fails', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    mocks.generateObject.mockRejectedValueOnce(new Error('Internal server error from Anthropic API'))

    await expect(answerEngine(makeInput([chunk]))).rejects.toBeInstanceOf(AnswerEngineError)
    await expect(answerEngine(makeInput([chunk]))).rejects.toMatchObject({
      code: 'llm_provider_error',
    })
  })

  it('throws AnswerEngineError with llm_rate_limited on 429', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 })
    mocks.generateObject.mockRejectedValueOnce(rateLimitError)

    await expect(answerEngine(makeInput([chunk]))).rejects.toMatchObject({
      code: 'llm_rate_limited',
    })
  })

  it('does not expose raw provider error messages', async () => {
    const chunk = makeChunk({ similarityScore: 0.90 })
    const providerError = new Error('sk-ant-api03-secret-key-leaked-in-error')
    mocks.generateObject.mockRejectedValueOnce(providerError)

    try {
      await answerEngine(makeInput([chunk]))
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AnswerEngineError)
      const engineErr = err as AnswerEngineError
      expect(engineErr.message).not.toContain('sk-ant')
      expect(engineErr.message).not.toContain('secret-key-leaked')
    }
  })
})

// ---------------------------------------------------------------------------
// Aislamiento de tenant
// ---------------------------------------------------------------------------

describe('answerEngine — module isolation', () => {
  it('does not accept orgId or studyId — the function is a pure engine', () => {
    // Type-level guarantee: AnswerEngineInput only has question + retrievedChunks.
    // This test verifies at runtime that calling with only those params succeeds.
    const input: AnswerEngineInput = {
      question: 'What is the primary endpoint?',
      retrievedChunks: [],
    }
    // Returns immediately with insufficient_evidence — no LLM needed.
    return expect(answerEngine(input)).resolves.toMatchObject({
      confidence: 'insufficient_evidence',
      evidences: [],
    })
  })
})

// ---------------------------------------------------------------------------
// buildContext helper
// ---------------------------------------------------------------------------

describe('buildContext', () => {
  it('numbers chunks starting at 1 (1-based indexing for LLM citations)', () => {
    const chunks = [makeChunk(), makeChunk()]
    const context = buildContext(chunks)

    expect(context).toContain('[1]')
    expect(context).toContain('[2]')
    expect(context).not.toContain('[0]')
  })

  it('includes documentType, page range and sectionTitle in the header', () => {
    const chunk = makeChunk({
      documentType: 'lab_manual',
      pageStart: 5,
      pageEnd: 7,
      sectionTitle: 'Sample Processing',
    })
    const context = buildContext([chunk])

    expect(context).toContain('lab_manual')
    expect(context).toContain('pp. 5-7')
    expect(context).toContain('Sample Processing')
  })

  it('uses singular page notation when pageStart equals pageEnd', () => {
    const chunk = makeChunk({ pageStart: 3, pageEnd: 3 })
    const context = buildContext([chunk])

    expect(context).toContain('p. 3')
    expect(context).not.toContain('pp. 3-3')
  })
})

// ---------------------------------------------------------------------------
// detectQuestionLanguage
// ---------------------------------------------------------------------------

describe('detectQuestionLanguage', () => {
  it('returns "es" when the question starts with ¿', () => {
    expect(detectQuestionLanguage('¿Cuál es el criterio de inclusión?')).toBe('es')
  })

  it('returns "es" when the question contains ñ', () => {
    expect(detectQuestionLanguage('Información sobre el estudio')).toBe('es')
  })

  it('returns "es" when the question contains accented vowels', () => {
    expect(detectQuestionLanguage('¿Qué procedimiento se aplica?')).toBe('es')
  })

  it('returns "es" for a typical Spanish clinical question', () => {
    expect(detectQuestionLanguage('¿Cuál es el timeline de reporte para un SAE serio inesperado?')).toBe('es')
  })

  it('returns "es" based on Spanish function words even without diacritics', () => {
    expect(detectQuestionLanguage('que criterios tiene el estudio')).toBe('es')
  })

  it('returns "en" for a typical English clinical question', () => {
    expect(detectQuestionLanguage('What are the eligibility criteria for HbA1c?')).toBe('en')
  })

  it('returns "en" for English questions about SAE reporting', () => {
    expect(detectQuestionLanguage('What is the SAE reporting timeline?')).toBe('en')
  })

  it('defaults to "en" for ambiguous or unknown input', () => {
    expect(detectQuestionLanguage('HbA1c 9.2%')).toBe('en')
  })
})

// ---------------------------------------------------------------------------
// getInsufficientEvidenceMessage
// ---------------------------------------------------------------------------

describe('getInsufficientEvidenceMessage', () => {
  it('returns the Spanish message for a Spanish question', () => {
    const msg = getInsufficientEvidenceMessage('¿Cuál es el criterio de inclusión?')
    expect(msg).toBe(INSUFFICIENT_EVIDENCE_MESSAGES.es)
  })

  it('returns the English message for an English question', () => {
    const msg = getInsufficientEvidenceMessage('What is the eligibility criteria?')
    expect(msg).toBe(INSUFFICIENT_EVIDENCE_MESSAGES.en)
  })
})

// ---------------------------------------------------------------------------
// i18n fallback — pre-LLM (sin llamar al LLM)
// ---------------------------------------------------------------------------

describe('answerEngine — i18n fallback pre-LLM', () => {
  it('returns Spanish message when retrievedChunks is empty and question is in Spanish', async () => {
    const spanishQuestion = '¿Cuál es el criterio de HbA1c para inclusión?'
    const result = await answerEngine(makeInput([], spanishQuestion))

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.answer).toBe(INSUFFICIENT_EVIDENCE_MESSAGES.es)
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('returns Spanish message when chunks are below threshold and question is in Spanish', async () => {
    const belowThreshold = makeChunk({ similarityScore: MIN_SIMILARITY_THRESHOLD - 0.01 })
    const spanishQuestion = '¿Qué procedimiento se aplica para las muestras PK?'

    const result = await answerEngine(makeInput([belowThreshold], spanishQuestion))

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.answer).toBe(INSUFFICIENT_EVIDENCE_MESSAGES.es)
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('returns English message when retrievedChunks is empty and question is in English', async () => {
    const englishQuestion = 'What is the primary endpoint of this study?'
    const result = await answerEngine(makeInput([], englishQuestion))

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.answer).toBe(INSUFFICIENT_EVIDENCE_MESSAGES.en)
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('does not call the LLM in any pre-LLM fallback scenario', async () => {
    await answerEngine(makeInput([], '¿Tiene información sobre metformina?'))
    await answerEngine(makeInput([makeChunk({ similarityScore: MIN_SIMILARITY_THRESHOLD - 0.01 })], 'What about metformin?'))

    expect(mocks.generateObject).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// conversationHistory — memoria por estudio (cross-session)
// ---------------------------------------------------------------------------

describe('answerEngine — conversationHistory', () => {
  function makeHistory(turns: number): ConversationTurn[] {
    return Array.from({ length: turns }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as ConversationTurn['role'],
      content: `turn-${i + 1}`,
    }))
  }

  function lastPrompt(): string {
    const call = mocks.generateObject.mock.calls.at(-1)?.[0] as { prompt: string }
    return call.prompt
  }

  it('injects the history block before the question when history is provided', async () => {
    mocks.generateObject.mockResolvedValue(makeLLMResponse({}))
    const history: ConversationTurn[] = [
      { role: 'user', content: '¿Qué procedimientos tiene la visita 4?' },
      { role: 'assistant', content: 'La visita 4 incluye HbA1c y muestra PK [1].' },
    ]

    await answerEngine({ ...makeInput([makeChunk()], '¿Y la visita 5?'), conversationHistory: history })

    const prompt = lastPrompt()
    expect(prompt).toContain('CONVERSATION HISTORY (context only — NOT evidence):')
    expect(prompt).toContain('USER: ¿Qué procedimientos tiene la visita 4?')
    expect(prompt).toContain('ASSISTANT: La visita 4 incluye HbA1c y muestra PK [1].')
    // El historial precede a la pregunta actual.
    expect(prompt.indexOf('CONVERSATION HISTORY')).toBeLessThan(prompt.indexOf('USER QUESTION:'))
  })

  it('omits the history block when history is absent or empty', async () => {
    mocks.generateObject.mockResolvedValue(makeLLMResponse({}))

    await answerEngine(makeInput([makeChunk()]))
    expect(lastPrompt()).not.toContain('CONVERSATION HISTORY')

    await answerEngine({ ...makeInput([makeChunk()]), conversationHistory: [] })
    expect(lastPrompt()).not.toContain('CONVERSATION HISTORY')
  })

  it('windows the history to the last MAX_HISTORY_TURNS turns', async () => {
    mocks.generateObject.mockResolvedValue(makeLLMResponse({}))
    const history = makeHistory(MAX_HISTORY_TURNS + 2)

    await answerEngine({ ...makeInput([makeChunk()]), conversationHistory: history })

    const prompt = lastPrompt()
    expect(prompt).not.toContain('turn-1\n')
    expect(prompt).not.toContain(': turn-2')
    expect(prompt).toContain(`turn-${MAX_HISTORY_TURNS + 2}`)
  })

  it('truncates each turn at HISTORY_TURN_MAX_CHARS', () => {
    const longTurn: ConversationTurn = {
      role: 'assistant',
      content: 'palabra '.repeat(400), // >> HISTORY_TURN_MAX_CHARS
    }
    const block = buildHistoryBlock([longTurn])
    expect(block.length).toBeLessThanOrEqual('ASSISTANT: '.length + HISTORY_TURN_MAX_CHARS + 1) // +1 por '…'
    expect(block.endsWith('…')).toBe(true)
  })

  it('history does NOT bypass the pre-LLM insufficient_evidence fallback', async () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: '¿Cuál es el rango de HbA1c?' },
      { role: 'assistant', content: 'Entre 7.0% y 10.0% [1].' },
    ]

    const result = await answerEngine({
      ...makeInput([], '¿Y me lo repetís?'),
      conversationHistory: history,
    })

    expect(result.confidence).toBe('insufficient_evidence')
    expect(result.evidences).toEqual([])
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// extractCitationIndicesFromAnswer
// ---------------------------------------------------------------------------

describe('extractCitationIndicesFromAnswer', () => {
  it('extrae índices únicos en orden de aparición', () => {
    expect(extractCitationIndicesFromAnswer('Foo [1] bar [3] y [1]', 5)).toEqual([1, 3])
  })

  it('ignora índices fuera de rango', () => {
    expect(extractCitationIndicesFromAnswer('Ref [9]', 3)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// answerEngineStream — streaming real via streamText
// ---------------------------------------------------------------------------

describe('answerEngineStream', () => {
  it('emite tokens del streamText antes del evento done', async () => {
    async function* fakeStream() {
      yield 'Plazo de '
      yield '24 horas [1]'
    }
    mocks.streamText.mockReturnValue({
      textStream: fakeStream(),
      text: Promise.resolve('Plazo de 24 horas [1]'),
    })
    mocks.generateObject.mockResolvedValueOnce({ object: { confidence: 'high' } })

    const chunk = makeChunk({
      content: 'Notify within 24 hours of SAE awareness.',
      similarityScore: 0.92,
    })
    const events: Array<{ type: string; text?: string; confidence?: string }> = []
    for await (const event of answerEngineStream(makeInput([chunk]))) {
      events.push(event)
    }

    const tokens = events.filter((e) => e.type === 'token').map((e) => e.text).join('')
    expect(tokens).toBe('Plazo de 24 horas [1]')
    expect(events.at(-1)).toMatchObject({ type: 'done', confidence: 'high' })
    expect(mocks.streamText).toHaveBeenCalled()
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
  })

  it('no llama streamText cuando no hay evidencia suficiente', async () => {
    const events: Array<{ type: string; text?: string; confidence?: string }> = []
    for await (const event of answerEngineStream(makeInput([]))) {
      events.push(event)
    }

    expect(mocks.streamText).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'done', confidence: 'insufficient_evidence' })
  })
})
