import type { ParsedPage } from './parser'

/**
 * chunker.ts — chunking section-aware con fallback a ventana de tokens.
 *
 * Estrategia (ARCHITECTURE.md → Chunking strategy):
 *  1. Section-aware: detectar headings; un chunk = sección si entra en ventana.
 *  2. Fallback: ventana de 800–1200 tokens con 128 de overlap.
 *
 * Metadata OBLIGATORIA por chunk: page_start, page_end, section_title (nullable),
 * token_count. Los boundaries de tenant (organization_id, study_id) los agrega
 * el pipeline al persistir; el chunker trabaja a nivel de contenido.
 */

export const CHUNK_TARGET_TOKENS_MIN = 800
export const CHUNK_TARGET_TOKENS_MAX = 1200
export const CHUNK_OVERLAP_TOKENS = 128

export interface ContentChunk {
  content: string
  pageStart: number
  pageEnd: number
  sectionTitle: string | null
  tokenCount: number
}

export interface ChunkOptions {
  targetTokensMin?: number
  targetTokensMax?: number
  overlapTokens?: number
}

/**
 * Divide las páginas parseadas en chunks listos para embeddings.
 */
export function chunkPages(pages: ParsedPage[], options: ChunkOptions = {}): ContentChunk[] {
  // TODO(paso-5): detección de secciones + ventana con overlap.
  void pages
  void options
  throw new Error('chunkPages not implemented (paso 5)')
}

/**
 * Estimación de tokens. Placeholder hasta integrar un tokenizer real.
 * ~4 caracteres por token es una aproximación razonable para inglés/español.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
