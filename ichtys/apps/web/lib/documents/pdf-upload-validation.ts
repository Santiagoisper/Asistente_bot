/**
 * Misma barra para la subida individual y la importación masiva.
 * El MIME lo declara el cliente; la firma "%PDF-" es la evidencia.
 */
export const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024
/**
 * Tope del cuerpo multipart completo, medido en bytes reales.
 * Alcanza para un PDF al máximo más el marco del formulario.
 * El Content-Length no alcanza: se puede falsificar.
 */
export const MAX_UPLOAD_BODY_BYTES = MAX_PDF_UPLOAD_BYTES + 64 * 1024

const PDF_MAGIC_BYTES = '%PDF-'

export type PdfUploadVerdict = 'ok' | 'unsupported_media' | 'too_large'

export async function validatePdfUpload(file: File): Promise<PdfUploadVerdict> {
  if (file.type !== 'application/pdf') return 'unsupported_media'
  if (file.size > MAX_PDF_UPLOAD_BYTES) return 'too_large'

  const head = new Uint8Array(await file.slice(0, PDF_MAGIC_BYTES.length).arrayBuffer())
  if (head.length < PDF_MAGIC_BYTES.length) return 'unsupported_media'
  return new TextDecoder('ascii').decode(head) === PDF_MAGIC_BYTES ? 'ok' : 'unsupported_media'
}
