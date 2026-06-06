import { describe, expect, it } from 'vitest'
import { chunkPages } from '../chunker'

describe('chunkPages', () => {
  it('preserves page_start and page_end across page boundaries', () => {
    const repeated = 'Eligibility criteria require documented lab review. '.repeat(18)
    const chunks = chunkPages(
      [
        { pageNumber: 3, rawText: `1. ELIGIBILITY\n${repeated}` },
        { pageNumber: 4, rawText: repeated },
      ],
      {
        targetTokensMin: 60,
        targetTokensMax: 90,
        overlapTokens: 10,
      },
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({
      pageStart: 3,
      sectionTitle: '1. ELIGIBILITY',
    })
    expect(chunks.some((chunk) => chunk.pageStart === 3 && chunk.pageEnd === 4)).toBe(true)
    expect(chunks.every((chunk) => chunk.tokenCount > 0)).toBe(true)
  })
})
