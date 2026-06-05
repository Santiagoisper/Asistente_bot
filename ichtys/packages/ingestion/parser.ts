/**
 * parser.ts — extracción de texto de PDFs, página por página.
 *
 * El MVP NO hace OCR (PRD §6: out of scope). Si una página no tiene texto
 * extraíble, se conserva el número de página con texto vacío para no romper
 * el mapeo de citas.
 */

export interface ParsedPage {
  pageNumber: number
  rawText: string
}

export interface ParsedDocument {
  pageCount: number
  pages: ParsedPage[]
}

/**
 * Extrae texto por página de un PDF.
 *
 * @param data - contenido del PDF (descargado desde Vercel Blob).
 */
export async function parsePdf(data: Buffer | Uint8Array): Promise<ParsedDocument> {
  // TODO(paso-5): implementar extracción real por página con pdf-parse / pdfjs.
  // Debe preservar el orden y el número de página (1-indexed) para citas exactas.
  void data
  throw new Error('parsePdf not implemented (paso 5)')
}
