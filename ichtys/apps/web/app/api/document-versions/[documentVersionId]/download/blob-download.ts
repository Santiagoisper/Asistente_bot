import { get } from '@vercel/blob'

interface PrivateDocumentPdf {
  stream: ReadableStream<Uint8Array>
  size: number | null
}

export async function getPrivateDocumentPdf(blobKey: string): Promise<PrivateDocumentPdf> {
  // Dev: leer desde el filesystem local (mismo mock que el pipeline de ingestion).
  if (process.env.NODE_ENV === 'development') {
    try {
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const { tmpdir } = await import('node:os')
      const safeKey = blobKey.replace(/\//g, '__')
      const localPath = join(tmpdir(), 'ichtys-dev-blobs', safeKey)
      const bytes = await readFile(localPath)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
      return { stream, size: bytes.byteLength }
    } catch {
      // Fall through to Vercel Blob if local file not found.
    }
  }

  const result = await get(blobKey, { access: 'private', useCache: false })

  if (!result || result.statusCode === 304 || !result.stream) {
    throw new Error('blob_download_failed')
  }

  return {
    stream: result.stream,
    size: result.blob.size,
  }
}
