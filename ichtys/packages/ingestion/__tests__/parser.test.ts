import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock pdf-parse — tests verify parsePdf logic, not the underlying library.
// ---------------------------------------------------------------------------

const mockPdfParse = vi.hoisted(() => vi.fn())

vi.mock('pdf-parse', () => ({ default: mockPdfParse }))

import { parsePdf, PdfParseError } from '../parser'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parsePdf', () => {
  it('extracts text by page using the pagerender callback', async () => {
    mockPdfParse.mockImplementation(
      async (_buf: unknown, opts: { pagerender?: (page: unknown) => Promise<string> }) => {
        if (opts?.pagerender) {
          const fakePageData = {
            getTextContent: async () => ({
              items: [
                { str: 'Hello', hasEOL: false },
                { str: ' PDF page one', hasEOL: true },
              ],
            }),
          }
          await opts.pagerender(fakePageData)
        }
        return { numpages: 1, text: 'Hello PDF page one' }
      },
    )

    const parsed = await parsePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46]))

    expect(parsed.pageCount).toBe(1)
    expect(parsed.pages[0]).toMatchObject({
      pageNumber: 1,
      rawText: expect.stringContaining('Hello PDF page one'),
    })
  })

  it('throws PdfParseError when pdf-parse fails', async () => {
    mockPdfParse.mockRejectedValue(new Error('corrupt pdf'))

    await expect(parsePdf(new Uint8Array([0x00]))).rejects.toThrow(PdfParseError)
  })

  it('throws PdfParseError when all pages have empty text', async () => {
    mockPdfParse.mockImplementation(
      async (_buf: unknown, opts: { pagerender?: (page: unknown) => Promise<string> }) => {
        if (opts?.pagerender) {
          const emptyPage = { getTextContent: async () => ({ items: [] }) }
          await opts.pagerender(emptyPage)
        }
        return { numpages: 1, text: '' }
      },
    )

    await expect(parsePdf(new Uint8Array([0x00]))).rejects.toThrow(PdfParseError)
  })
})
