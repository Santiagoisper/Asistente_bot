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

export type StoredBlobReadErrorCode =
  | 'blob_private_read_failed'
  | 'blob_not_found'
  | 'blob_download_failed'

export class StoredBlobReadError extends Error {
  constructor(
    readonly code: StoredBlobReadErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'StoredBlobReadError'
  }
}

/**
 * Host de los stores PUBLICOS de Vercel Blob (`<store>.public.blob...`).
 * Los objetos subidos antes de SEC-01 viven ahi y pueden leerse sin
 * credenciales; cualquier otro host debe leerse como privado y NUNCA caer a
 * un fetch publico si falla la autenticacion.
 */
const LEGACY_PUBLIC_HOSTNAME = /(^|\.)public\.blob\.vercel-storage\.com$/

function isLegacyPublicBlobUrl(blobUrl: string): boolean {
  try {
    return LEGACY_PUBLIC_HOSTNAME.test(new URL(blobUrl).hostname)
  } catch {
    return false
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

/**
 * Lee un objeto como privado. Devuelve null solo cuando el SDK responde 404
 * (el objeto no existe como privado). Los errores del SDK (token ausente o
 * vencido, red, 5xx) se propagan: quien llama decide, y solo un objeto de un
 * store publico legado puede caer al fetch sin credenciales.
 */
async function readPrivateBlob(blobUrl: string): Promise<StoredBlobStream | null> {
  const { get } = await import('@vercel/blob')
  const result = await get(blobUrl, { access: 'private' })
  if (!result || result.statusCode !== 200) return null
  return { stream: result.stream, size: result.blob.size }
}

async function readLegacyPublicBlob(blobUrl: string): Promise<StoredBlobStream> {
  console.warn('[blob-read] legacy public blob read; migrate this object to private storage')
  const response = await fetch(blobUrl)
  if (!response.ok || !response.body) {
    throw new StoredBlobReadError(
      'blob_download_failed',
      `No se pudo descargar el blob legado (HTTP ${response.status})`,
    )
  }
  const contentLength = response.headers.get('content-length')
  return { stream: response.body, size: contentLength ? parseInt(contentLength, 10) : null }
}

export async function openStoredBlob(blobUrl: string): Promise<StoredBlobStream> {
  if (blobUrl.startsWith('file://')) return readLocalDevBlob(blobUrl)

  const isLegacy = isLegacyPublicBlobUrl(blobUrl)

  let priv: StoredBlobStream | null
  try {
    priv = await readPrivateBlob(blobUrl)
  } catch (err) {
    // Error del SDK (no de "objeto inexistente"): token ausente/vencido, red
    // o 5xx. Solo un objeto de un store PUBLICO legado puede leerse sin
    // credenciales. Antes se caia siempre al fetch publico y un problema de
    // configuracion terminaba como 403 + un warn que culpaba al objeto.
    if (isLegacy) return readLegacyPublicBlob(blobUrl)
    throw new StoredBlobReadError(
      'blob_private_read_failed',
      'No se pudo leer el objeto privado; revisá BLOB_READ_WRITE_TOKEN y la salud del store',
      { cause: err },
    )
  }
  if (priv) return priv

  // El SDK respondio 404: el objeto no existe como privado.
  if (isLegacy) return readLegacyPublicBlob(blobUrl)
  throw new StoredBlobReadError('blob_not_found', 'El objeto no existe en el almacenamiento privado')
}
