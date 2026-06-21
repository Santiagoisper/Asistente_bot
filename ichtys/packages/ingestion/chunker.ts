import type { ParsedPage } from './parser'

/**
 * chunker.ts - lightweight chunking for extracted page text.
 *
 * This phase does not implement robust layout analysis. It uses an approximate
 * character window and preserves page ranges for future citations.
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

interface PageSpan {
  pageNumber: number
  start: number
  end: number
}

interface CombinedPages {
  text: string
  spans: PageSpan[]
}

function combinePages(pages: ParsedPage[]): CombinedPages {
  let cursor = 0
  const textParts: string[] = []
  const spans: PageSpan[] = []

  for (const page of pages) {
    const rawText = page.rawText.trim()
    if (rawText.length === 0) continue

    if (textParts.length > 0) {
      textParts.push('\n\n')
      cursor += 2
    }

    const start = cursor
    textParts.push(rawText)
    cursor += rawText.length
    spans.push({ pageNumber: page.pageNumber, start, end: cursor })
  }

  return { text: textParts.join(''), spans }
}

function chooseWindowEnd(text: string, start: number, minChars: number, maxChars: number): number {
  const hardEnd = Math.min(text.length, start + maxChars)
  if (hardEnd === text.length) return hardEnd

  const minEnd = Math.min(text.length, start + minChars)
  const slice = text.slice(minEnd, hardEnd)
  const lastParagraphBreak = slice.lastIndexOf('\n\n')
  if (lastParagraphBreak >= 0) return minEnd + lastParagraphBreak

  const lastSentenceBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'))
  if (lastSentenceBreak >= 0) return minEnd + lastSentenceBreak + 1

  const lastSpace = slice.lastIndexOf(' ')
  if (lastSpace >= 0) return minEnd + lastSpace

  return hardEnd
}

function pageForOffset(spans: readonly PageSpan[], offset: number): number {
  const span = spans.find((candidate) => offset >= candidate.start && offset < candidate.end)
  return span?.pageNumber ?? spans[spans.length - 1]?.pageNumber ?? 1
}

function detectSectionTitle(content: string): string | null {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine || firstLine.length < 3 || firstLine.length > 120) return null
  if (firstLine.split(/\s+/).length > 16) return null

  const numberedHeading = /^\d+(\.\d+)*[.)]?\s+[A-Z0-9]/.test(firstLine)
  const uppercaseHeading =
    firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine) && !firstLine.endsWith('.')

  return numberedHeading || uppercaseHeading ? firstLine : null
}

/**
 * Splits parsed pages into content chunks ready for future embeddings.
 */
export function chunkPages(pages: ParsedPage[], options: ChunkOptions = {}): ContentChunk[] {
  const minTokens = options.targetTokensMin ?? CHUNK_TARGET_TOKENS_MIN
  const maxTokens = options.targetTokensMax ?? CHUNK_TARGET_TOKENS_MAX
  const overlapTokens = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS
  const minChars = Math.max(1, minTokens * 4)
  const maxChars = Math.max(minChars, maxTokens * 4)
  const overlapChars = Math.max(0, Math.min(overlapTokens * 4, Math.floor(maxChars / 2)))
  const combined = combinePages(pages)

  if (combined.text.trim().length === 0) return []

  const chunks: ContentChunk[] = []
  let start = 0

  while (start < combined.text.length) {
    while (combined.text[start] === ' ' || combined.text[start] === '\n') {
      start += 1
    }

    if (start >= combined.text.length) break

    const end = chooseWindowEnd(combined.text, start, minChars, maxChars)
    const content = combined.text.slice(start, end).trim()
    if (content.length > 0) {
      const trimmedStart = combined.text.indexOf(content[0] ?? '', start)
      const pageStart = pageForOffset(combined.spans, trimmedStart >= 0 ? trimmedStart : start)
      const pageEnd = pageForOffset(combined.spans, Math.max(start, end - 1))
      chunks.push({
        content,
        pageStart,
        pageEnd,
        sectionTitle: detectSectionTitle(content),
        tokenCount: estimateTokens(content),
      })
    }

    if (end >= combined.text.length) break
    const nextStart = Math.max(start + 1, end - overlapChars)
    start = nextStart
  }

  return chunks
}

/**
 * Approximate token count until a real tokenizer is introduced.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
