/**
 * blob-read.ts - lectura server-side de PDFs almacenados.
 *
 * Los objetos nuevos se guardan con access 'private' (ver blob-storage.ts en
 * apps/web), por lo que solo pueden leerse con el token del servidor. Los
 * objetos subidos antes de SEC-01 siguen siendo publicos: para ellos se
 * conserva un fallback con fetch plano hasta que se migren.
 */

export interface StoredBlobStream {
  stream: ReadableStream<Uint8Array>
  size: number | null
}

export class StoredBlobReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoredBlobReadError'
  }
}

async function readLocalDevBlob(blobUrl: string): Promise<StoredBlobStream> {
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

async function readPrivateBlob(blobUrl: string): Promise<StoredBlobStream | null> {
  try {
    const { get } = await import('@vercel/blob')
    const result = await get(blobUrl, { access: 'private' })
    if (!result || result.statusCode !== 200) return null
    return { stream: result.stream, size: result.blob.size }
  } catch {
    // El objeto puede ser legado (publico) o el SDK no estar configurado:
    // se decide en el llamador, sin exponer detalles internos.
    return null
  }
}

async function readLegacyPublicBlob(blobUrl: string): Promise<StoredBlobStream> {
  console.warn('[blob-read] legacy public blob read; migrate this object to private storage')
  const response = await fetch(blobUrl)
  if (!response.ok || !response.body) {
    throw new StoredBlobReadError(`blob_download_failed: ${response.status}`)
  }
  const contentLength = response.headers.get('content-length')
  return { stream: response.body, size: contentLength ? parseInt(contentLength, 10) : null }
}

export async function openStoredBlob(blobUrl: string): Promise<StoredBlobStream> {
  if (blobUrl.startsWith('file://')) return readLocalDevBlob(blobUrl)

  const priv = await readPrivateBlob(blobUrl)
  if (priv) return priv

  return readLegacyPublicBlob(blobUrl)
}
