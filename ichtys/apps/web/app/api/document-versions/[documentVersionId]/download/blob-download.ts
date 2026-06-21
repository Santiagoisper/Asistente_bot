import { get } from '@vercel/blob'

interface PrivateDocumentPdf {
  stream: ReadableStream<Uint8Array>
  size: number | null
}

export async function getPrivateDocumentPdf(blobKey: string): Promise<PrivateDocumentPdf> {
  const result = await get(blobKey, { access: 'private', useCache: false })

  if (!result || result.statusCode === 304 || !result.stream) {
    throw new Error('blob_download_failed')
  }

  return {
    stream: result.stream,
    size: result.blob.size,
  }
}
