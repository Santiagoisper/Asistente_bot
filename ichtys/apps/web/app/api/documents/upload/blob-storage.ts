import { randomUUID } from 'node:crypto'

interface PutPrivateDocumentPdfInput {
  blobKey: string
  file: File
}

interface StoredDocumentBlob {
  url: string
  pathname: string
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

function putPrivateBlobDev(
  blobKey: string,
  file: File
): StoredDocumentBlob {
  const mockId = randomUUID().substring(0, 8)
  const pathname = `${blobKey}-${mockId}`
  const mockUrl = `https://blob.vercelusercontent.com/dev/${pathname}`

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV-MOCK Blob] Stored "${file.name}" (${file.size} bytes) → ${pathname}`)
  }

  return {
    url: mockUrl,
    pathname,
  }
}

export async function putPrivateDocumentPdf({
  blobKey,
  file,
}: PutPrivateDocumentPdfInput): Promise<StoredDocumentBlob> {
  // Use real Blob only if explicitly enabled + BLOB_READ_WRITE_TOKEN is set
  const useRealBlob = process.env.BLOB_UPLOAD_ENABLED === 'true' && process.env.BLOB_READ_WRITE_TOKEN
  console.log(`[blob-storage] useRealBlob=${useRealBlob}`)

  if (!useRealBlob) {
    console.log('[blob-storage] Using DEV mock (no BLOB_UPLOAD_ENABLED)')
    return putPrivateBlobDev(blobKey, file)
  }

  return putPrivateBlobProduction(blobKey, file)
}
