import pdfParse from 'pdf-parse'

/**
 * parser.ts - PDF text extraction, page by page.
 *
 * Uses pdf-parse which ships its own CJS-compatible pdfjs builds — avoids the
 * ESM-only / DOMMatrix issues that pdfjs-dist v6 causes in Next.js Lambda builds.
 *
 * OCR is out of scope for this phase. Scanned PDFs with no extractable text
 * fail with a controlled error so ingestion can mark the version as error.
 */

export interface ParsedPage {
  pageNumber: number
  rawText: string
}

export interface ParsedDocument {
  pageCount: number
  pages: ParsedPage[]
}

export type PdfParseErrorCode =
  | 'pdf_text_extraction_failed'
  | 'pdf_contains_no_extractable_text'

export class PdfParseError extends Error {
  constructor(
    readonly code: PdfParseErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PdfParseError'
  }
}

interface PdfTextItem {
  str: string
  hasEOL?: boolean
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  if (typeof item !== 'object' || item === null) return false
  return 'str' in item && typeof item.str === 'string'
}

function normalizePageText(items: readonly unknown[]): string {
  return items
    .filter(isPdfTextItem)
    .map((item) => (item.hasEOL ? `${item.str}\n` : item.str))
    .join(' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Extracts text by page from a PDF buffer.
 */
export async function parsePdf(data: Buffer | Uint8Array): Promise<ParsedDocument> {
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const pages: ParsedPage[] = []
    let pageCounter = 0

    await pdfParse(buffer, {
      // pagerender is called sequentially for each page (1..numpages).
      // Capture per-page text via closure; return value is appended to result.text.
      pagerender: (pageData: { getTextContent: (opts?: object) => Promise<{ items: unknown[] }> }) => {
        const currentPage = ++pageCounter
        return pageData
          .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
          .then((textContent) => {
            const rawText = normalizePageText(textContent.items)
            pages.push({ pageNumber: currentPage, rawText })
            return rawText
          })
      },
    })

    if (!pages.some((page) => page.rawText.trim().length > 0)) {
      throw new PdfParseError(
        'pdf_contains_no_extractable_text',
        'PDF contains no extractable text; OCR is out of scope for this phase',
      )
    }

    return { pageCount: pages.length, pages }
  } catch (err) {
    if (err instanceof PdfParseError) {
      throw err
    }

    throw new PdfParseError('pdf_text_extraction_failed', 'Failed to extract text from PDF')
  }
}
