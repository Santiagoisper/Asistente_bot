import { z } from 'zod'

/**
 * pipeline.ts — orquestador de ingestion (sin frameworks; código propio).
 *
 * Flujo (ARCHITECTURE.md → Ingestion pipeline):
 *   blob descargado → parse por página → chunk → embed → persistir
 *   pages + chunks → status: ready → audit log.
 *
 * Idempotencia: opera sobre un `documentVersionId`. Reprocesar una versión
 * debe limpiar pages/chunks previos de esa versión antes de reinsertar.
 */

export const runIngestionInput = z.object({
  organizationId: z.string().uuid(),
  studyId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
})

export type RunIngestionInput = z.infer<typeof runIngestionInput>

export interface IngestionResult {
  documentVersionId: string
  pageCount: number
  chunkCount: number
  status: 'ready' | 'error'
  errorMessage?: string
}

/**
 * Ejecuta el pipeline completo para una versión de documento.
 * Toda la metadata de tenant (organization_id, study_id) se propaga a pages y
 * chunks; nunca se persiste un chunk sin esos boundaries.
 */
export async function runIngestion(input: RunIngestionInput): Promise<IngestionResult> {
  // TODO(paso-5): orquestar parser → chunker → embedder → persistencia + audit.
  void runIngestionInput.parse(input)
  throw new Error('runIngestion not implemented (paso 5)')
}

export { parsePdf } from './parser'
export { chunkPages } from './chunker'
export { embedBatch, embedQuery } from './embedder'
