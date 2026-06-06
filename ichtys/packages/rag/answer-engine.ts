import { z } from 'zod'
import { answerConfidence, type AnswerConfidence } from '@ichtys/db'
import { retrieve, type RetrievedChunk } from './retriever'
import { assessEvidence, insufficientEvidenceAnswer } from './guardrails'

/**
 * answer-engine.ts — ensambla el prompt grounded, llama al LLM (Claude vía
 * Vercel AI SDK) y arma la respuesta estructurada con citas.
 *
 * Reglas (CLAUDE.md 6–8, ARCHITECTURE.md → Answer engine):
 *  - Responder SOLO desde chunks recuperados.
 *  - Toda afirmación referencia una cita [n].
 *  - Sin evidencia => fallback insufficient_evidence (no se llama al LLM).
 *  - Nunca mezclar documentos de distintos estudios (garantizado por el filtro
 *    org+study en el retriever).
 */

export const SYSTEM_PROMPT = `You are a clinical research assistant for study site operations.

CRITICAL RULES:
1. Answer ONLY based on the provided document excerpts. Never add information from general knowledge.
2. Every claim must reference a specific citation by number [1], [2], etc.
3. If the provided excerpts don't contain enough information to answer, respond with: "I don't have sufficient evidence in the uploaded documents to answer this question. Please consult the study team or review the source documents directly."
4. Be concise. Lead with the direct answer, then cite the source.
5. Never speculate, extrapolate, or infer beyond what the text states.

Respond in the same language as the question.`

/** Schema de salida estructurada del LLM (PRD §7.4). */
export const answerSchema = z.object({
  answer: z.string(),
  confidence: z.enum(answerConfidence),
  citationIndices: z.array(z.number().int().nonnegative()),
})

export type StructuredAnswer = z.infer<typeof answerSchema>

export interface AnswerCitation {
  chunkId: string
  documentId: string
  documentVersionId: string
  pageStart: number
  pageEnd: number
  sectionTitle: string | null
  excerpt: string
  similarityScore: number
}

export interface AnswerResult {
  answer: string
  confidence: AnswerConfidence
  citations: AnswerCitation[]
  retrievedChunkCount: number
}

export interface GenerateAnswerParams {
  organizationId: string
  studyId: string
  question: string
  topK?: number
}

/**
 * Punto de entrada del answer engine (no-streaming; la API route puede usar
 * streamText reusando esta lógica de retrieval + guardrails).
 */
export async function generateAnswer(params: GenerateAnswerParams): Promise<AnswerResult> {
  const retrieved = await retrieve({
    organizationId: params.organizationId,
    studyId: params.studyId,
    query: params.question,
    topK: params.topK,
  })

  const assessment = assessEvidence(retrieved)

  if (!assessment.hasEvidence) {
    const fallback = insufficientEvidenceAnswer()
    return {
      answer: fallback.answer,
      confidence: fallback.confidence,
      citations: [],
      retrievedChunkCount: retrieved.length,
    }
  }

  // TODO(paso-7): llamar al LLM con generateObject(answerSchema) usando
  // buildContext(retrieved) y SYSTEM_PROMPT; mapear citationIndices → citations.
  void buildContext(retrieved)
  throw new Error('generateAnswer LLM step not implemented (paso 7)')
}

/**
 * Construye el bloque de contexto numerado que se inyecta en el prompt.
 * El índice (1-based) es el que el LLM usa para citar [n].
 */
export function buildContext(retrieved: RetrievedChunk[]): string {
  return retrieved
    .map((chunk, i) => {
      const header = `[${i + 1}] (${chunk.documentType}, pp. ${chunk.pageStart}-${chunk.pageEnd}${
        chunk.sectionTitle ? `, ${chunk.sectionTitle}` : ''
      })`
      return `${header}\n${chunk.content}`
    })
    .join('\n\n')
}

export { retrieve } from './retriever'
export * from './guardrails'
