import { put } from '@vercel/blob'

interface PutPrivateDocumentPdfInput {
  blobKey: string
  file: File
}

interface StoredDocumentBlob {
  url: string
  pathname: string
}

export async function putPrivateDocumentPdf({
  blobKey,
  file,
}: PutPrivateDocumentPdfInput): Promise<StoredDocumentBlob> {
  const blob = await put(blobKey, file, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/pdf',
  })

  return {
    url: blob.url,
    pathname: blob.pathname,
  }
}
