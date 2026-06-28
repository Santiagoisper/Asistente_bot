import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

interface PutPrivateDocumentPdfInput {
  blobKey: string
  file: File
}

interface StoredDocumentBlob {
  url: string
  pathname: string
}

// Directorio local donde el dev mock persiste los PDFs entre hot reloads.
// La ingestion pipeline lo lee con devBlobPath() en el pipeline.ts.
export const DEV_BLOB_DIR = join(tmpdir(), 'ichtys-dev-blobs')

// Convierte un blobKey (con slashes) a un nombre de archivo plano.
export function devBlobFileName(blobKey: string): string {
  return blobKey.replace(/\//g, '__')
}

async function putPrivateBlobProduction(
  blobKey: string,
  file: File
): Promise<StoredDocumentBlob> {
  try {
    const { put } = await import('@vercel/blob')
    const buffer = await file.arrayBuffer()

    const blob = await put(blobKey, Buffer.from(buffer), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/pdf',
    })

    return {
      url: blob.url,
      pathname: blob.pathname,
    }
  } catch (err) {
    console.error('[blob-storage] Production blob upload failed:', err)
    throw err
  }
}

async function putPrivateBlobDev(
  blobKey: string,
  file: File,
): Promise<StoredDocumentBlob> {
  const mockId = randomUUID().substring(0, 8)
  const pathname = `${blobKey}-${mockId}`

  // Guarda los bytes reales en disco para que la ingestion los pueda leer.
  await mkdir(DEV_BLOB_DIR, { recursive: true })
  const localPath = join(DEV_BLOB_DIR, devBlobFileName(pathname))
  const buffer = await file.arrayBuffer()
  await writeFile(localPath, new Uint8Array(buffer))

  console.log(`[DEV-MOCK Blob] Stored "${file.name}" (${file.size} bytes) → ${localPath}`)

  return {
    url: `file://${localPath}`,
    pathname,
  }
}

export async function putPrivateDocumentPdf({
  blobKey,
  file,
}: PutPrivateDocumentPdfInput): Promise<StoredDocumentBlob> {
  const useRealBlob = !!process.env.BLOB_READ_WRITE_TOKEN
  console.log(`[blob-storage] useRealBlob=${useRealBlob} env=${process.env.NODE_ENV}`)

  if (!useRealBlob) {
    if (process.env.NODE_ENV !== 'development') {
      console.error(
        '[blob-storage] BLOB_READ_WRITE_TOKEN not set — falling back to dev mock in production. Blobs will be lost between Lambda invocations.',
      )
    } else {
      console.log('[blob-storage] Using DEV mock — writing to local filesystem')
    }
    return putPrivateBlobDev(blobKey, file)
  }

  return putPrivateBlobProduction(blobKey, file)
}
