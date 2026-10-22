import { openStoredBlob } from '@ichtys/ingestion/blob-read'

interface PrivateDocumentPdf {
  stream: ReadableStream<Uint8Array>
  size: number | null
}

export async function getPrivateDocumentPdf(blobUrl: string): Promise<PrivateDocumentPdf> {
  return openStoredBlob(blobUrl)
}
