interface PrivateDocumentPdf {
  stream: ReadableStream<Uint8Array>
  size: number | null
}

export async function getPrivateDocumentPdf(blobUrl: string): Promise<PrivateDocumentPdf> {
  // Dev mock: blobUrl is file:// pointing to local filesystem.
  if (blobUrl.startsWith('file://')) {
    const { readFile } = await import('node:fs/promises')
    const localPath = blobUrl.replace('file://', '')
    const bytes = await readFile(localPath)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
    return { stream, size: bytes.byteLength }
  }

  const response = await fetch(blobUrl)

  if (!response.ok || !response.body) {
    throw new Error(`blob_download_failed: ${response.status}`)
  }

  const contentLength = response.headers.get('content-length')
  const size = contentLength ? parseInt(contentLength, 10) : null

  return {
    stream: response.body,
    size,
  }
}
