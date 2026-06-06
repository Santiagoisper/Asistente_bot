import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted — deben declararse antes de cualquier import del módulo bajo prueba.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockModel = Symbol('mock-anthropic-model')
  const anthropicProviderFn = vi.fn().mockReturnValue(mockModel)
  const createAnthropicFn = vi.fn().mockReturnValue(anthropicProviderFn)
  const generateObjectFn = vi.fn()

  return {
    mockModel,
    anthropicProviderFn,
    createAnthropic: createAnthropicFn,
    generateObject: generateObjectFn,
  }
})

vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: mocks.createAnthropic }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))

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
  AnswerEngineError,
  EXCERPT_MAX_CHARS,
  SYSTEM_PROMPT,
  truncateExcerpt,
  buildContext,
} from '../answer-engine'
import type { AnswerEngineInput } from '../answer-engine'
import type { RetrievedChunk } from '../retriever'
import { MIN_SIMILARITY_THRESHOLD } from '../guardrails'

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
