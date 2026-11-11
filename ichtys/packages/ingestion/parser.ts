import pdfParse from 'pdf-parse'
import { PDFDocument } from 'pdf-lib'

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
  | 'pdf_complexity_limit'

/** Protocolos reales superan las 200 páginas. 300 corta un PDF hostil sin rechazar un protocolo largo. */
const MAX_PDF_PAGES = 300
/** Tope de CPU del pagerender. pdf-parse llama este hook en serie, página por página. */
const MAX_PDF_PARSE_MS = 30_000
/** Una página de protocolo cabe holgada. Por encima es expansión hostil, no texto clínico. */
const MAX_PAGE_TEXT_CHARS = 100_000
/** 300 páginas densas, con margen, sin conservar un volcado de memoria. */
const MAX_DOCUMENT_TEXT_CHARS = 3_000_000

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PdfParseError(
        'pdf_complexity_limit',
        'PDF exceeds the page or extraction-time limit',
      ))
    }, ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

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
  let raw = ''
  for (const item of items) {
    if (!isPdfTextItem(item)) continue
    const piece = item.hasEOL ? `${item.str}\n` : `${item.str} `
    if (raw.length + piece.length > MAX_PAGE_TEXT_CHARS) {
      throw new PdfParseError('pdf_complexity_limit', 'PDF exceeds the extracted-text limit')
    }
    raw += piece
  }
  return raw
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

interface PositionedItem {
  str: string
  x: number
  y: number
  width: number | null
  height: number
}

function positionOf(item: unknown): PositionedItem | null {
  if (!isPdfTextItem(item)) return null
  const transform = (item as { transform?: unknown }).transform
  if (!Array.isArray(transform) || transform.length < 6) return null
  const [, , , scaleY, x, y] = transform as unknown[]
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const width = (item as { width?: unknown }).width
  const height = (item as { height?: unknown }).height
  return {
    str: item.str,
    x,
    y,
    width: typeof width === 'number' && Number.isFinite(width) ? width : null,
    height:
      typeof height === 'number' && height > 0 ? height : typeof scaleY === 'number' && scaleY !== 0 ? Math.abs(scaleY) : 10,
  }
}

/**
 * Texto de una página conservando los renglones: agrupa los ítems por su
 * altura en la página y los ordena de izquierda a derecha. Lo usa la carga de
 * laboratorios, donde cada renglón es un resultado. `normalizePageText` (RAG)
 * no cambia: une todo con espacios porque ahí el renglón no importa.
 */
export function normalizePageLines(items: readonly unknown[]): string {
  const positioned: PositionedItem[] = []
  for (const item of items) {
    const entry = positionOf(item)
    if (entry && entry.str.length > 0) positioned.push(entry)
  }
  // De arriba hacia abajo (en PDF la y crece hacia arriba) y de izquierda a derecha.
  positioned.sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: PositionedItem[][] = []
  for (const entry of positioned) {
    const current = lines[lines.length - 1]
    const anchor = current?.[0]
    if (current && anchor && Math.abs(anchor.y - entry.y) <= Math.max(2, Math.min(anchor.height, entry.height) * 0.5)) {
      current.push(entry)
    } else {
      lines.push([entry])
    }
  }

  let raw = ''
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    let text = ''
    let previous: PositionedItem | null = null
    for (const entry of line) {
      // Fragmentos de una misma palabra vienen pegados; columnas distintas, separadas.
      const glued = previous !== null && previous.width !== null && entry.x - (previous.x + previous.width) < 1
      text += previous === null || glued ? entry.str : ` ${entry.str}`
      previous = entry
    }
    const piece = `${text.replace(/[ \t]{2,}/g, ' ').trim()}\n`
    if (raw.length + piece.length > MAX_PAGE_TEXT_CHARS) {
      throw new PdfParseError('pdf_complexity_limit', 'PDF exceeds the extracted-text limit')
    }
    raw += piece
  }
  return raw.trim()
}

export interface ParsePdfOptions {
  /** Conserva los renglones de cada página (uno por línea). Por defecto, texto corrido. */
  preserveLines?: boolean
}

/**
 * Extracts text by page from a PDF buffer.
 */
export async function parsePdf(data: Buffer | Uint8Array, options: ParsePdfOptions = {}): Promise<ParsedDocument> {
  try {
    const source = Buffer.isBuffer(data) ? data : Buffer.from(data)
    // pdf.js 1.10 misreads a small Buffer (pooled or cloned). A fresh Uint8Array
    // is the view this build of pdf-parse actually parses.
    const buffer = new Uint8Array(source.byteLength)
    buffer.set(source)
    const pages: ParsedPage[] = []
    let pageCounter = 0
    let totalChars = 0
    let limitHit = false
    const startedAt = Date.now()
    const noteLimit = (): string => {
      limitHit = true
      return ''
    }

    // pdf-parse@1.1.4 does `.catch(() => "")` around each page, so a throw
    // inside pagerender never reaches us. The flag and the real numpages do.
    const result = await pdfParse(buffer as unknown as Buffer, {
      max: MAX_PDF_PAGES,
      pagerender: (pageData: { getTextContent: (opts?: object) => Promise<{ items: unknown[] }> }) => {
        const elapsed = Date.now() - startedAt
        if (pageCounter >= MAX_PDF_PAGES || elapsed >= MAX_PDF_PARSE_MS) return noteLimit()
        const currentPage = ++pageCounter
        const budgetMs = Math.max(1, MAX_PDF_PARSE_MS - elapsed)
        return withTimeout(
          pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }),
          budgetMs,
        ).then(
          (textContent) => {
            let rawText: string
            try {
              rawText = options.preserveLines ? normalizePageLines(textContent.items) : normalizePageText(textContent.items)
            } catch (err) {
              if (err instanceof PdfParseError && err.code === 'pdf_complexity_limit') return noteLimit()
              throw err
            }
            if (totalChars + rawText.length > MAX_DOCUMENT_TEXT_CHARS) return noteLimit()
            totalChars += rawText.length
            pages.push({ pageNumber: currentPage, rawText })
            return rawText
          },
          () => noteLimit(),
        )
      },
    })

    const reportedPages = typeof result?.numpages === 'number' ? result.numpages : pages.length
    if (limitHit || reportedPages > MAX_PDF_PAGES || reportedPages !== pages.length) {
      throw new PdfParseError(
        'pdf_complexity_limit',
        'PDF exceeds the page or extraction-time limit',
      )
    }

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

/** Copies a 1-based range of pages into a small standalone PDF for visual LLM input. */
export async function cropPdfPages(
  data: Buffer | Uint8Array,
  pageStart: number,
  pageEnd: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart) {
    throw new Error('Invalid PDF page range')
  }

  const source = await PDFDocument.load(data, { ignoreEncryption: false })
  if (pageEnd > source.getPageCount()) throw new Error('PDF page range exceeds document')

  const output = await PDFDocument.create()
  const indices = Array.from({ length: pageEnd - pageStart + 1 }, (_, offset) => pageStart - 1 + offset)
  const pages = await output.copyPages(source, indices)
  for (const page of pages) output.addPage(page)
  return output.save()
}
