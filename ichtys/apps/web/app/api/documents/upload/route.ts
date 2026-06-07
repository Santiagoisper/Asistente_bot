import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import { auditLogs, db, documents, documentVersions } from '@ichtys/db'
import { putPrivateDocumentPdf } from './blob-storage'

export const runtime = 'nodejs'

/**
 * Server route uploads are intentionally capped below the PRD target. Large
 * PDFs need a future client/direct upload flow before claiming 50MB support.
 */
const MAX_SERVER_UPLOAD_BYTES = 4 * 1024 * 1024
const MAX_PDF_BYTES = MAX_SERVER_UPLOAD_BYTES

const documentType = z.enum([
  'protocol',
  'investigator_brochure',
  'lab_manual',
  'pharmacy_manual',
  'other',
])

const uploadMeta = z.object({
  studyId: z.string().uuid(),
  name: z.string().min(1).optional(),
  documentType,
})

function getOptionalString(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function getRequiredString(form: FormData, key: string): string | null {
  const value = form.get(key)
  return typeof value === 'string' ? value : null
}

function safeBlobFileName(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')

  return sanitized.length > 0 ? sanitized : 'document.pdf'
}

function buildBlobKey(fileName: string): string {
  return `clinical-documents/${crypto.randomUUID()}/${safeBlobFileName(fileName)}`
}

/**
 * POST /api/documents/upload - validates study access, stores the PDF in
 * Vercel Blob, registers the document and its initial pending version.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    if (url.searchParams.has('organization_id') || url.searchParams.has('organizationId')) {
      return new Response('Bad Request', { status: 400 })
    }

    const form = await req.formData()

    if (form.has('organization_id') || form.has('organizationId')) {
      return new Response('Bad Request', { status: 400 })
    }

    const file = form.get('file')
    const meta = uploadMeta.safeParse({
      studyId: getRequiredString(form, 'studyId'),
      name: getOptionalString(form, 'name'),
      documentType: getRequiredString(form, 'documentType'),
    })

    if (!meta.success || !(file instanceof File)) {
      return new Response('Bad Request', { status: 400 })
    }

    if (file.type !== 'application/pdf') {
      return new Response('Unsupported Media Type', { status: 415 })
    }

    if (file.size > MAX_PDF_BYTES) {
      return new Response('Payload Too Large', { status: 413 })
    }

    const { userId, orgId, study } = await validateStudyAccess(meta.data.studyId)
    const fileName = file.name.trim().length > 0 ? file.name : 'document.pdf'
    const name = meta.data.name ?? fileName
    const blobKey = buildBlobKey(fileName)
    const blob = await putPrivateDocumentPdf({ blobKey, file })

    const result = await db.transaction(async (tx) => {
      const [document] = await tx
        .insert(documents)
        .values({
          organizationId: orgId,
          studyId: study.id,
          name,
          documentType: meta.data.documentType,
        })
        .returning()

      if (!document) {
        throw new Error('Document insert did not return a row')
      }

      // TODO(re-upload): compute max(version_number) + 1 for existing logical
      // documents once the UI supports uploading a new version of the same doc.
      const versionNumber = 1
      const [documentVersion] = await tx
        .insert(documentVersions)
        .values({
          documentId: document.id,
          organizationId: orgId,
          studyId: study.id,
          blobUrl: blob.url,
          blobKey: blob.pathname,
          fileSizeBytes: file.size,
          status: 'pending',
          versionNumber,
        })
        .returning()

      if (!documentVersion) {
        throw new Error('Document version insert did not return a row')
      }

      await tx.insert(auditLogs).values({
        organizationId: orgId,
        studyId: study.id,
        userId,
        action: 'document.upload',
        resourceType: 'document',
        resourceId: document.id,
        metadata: {
          documentVersionId: documentVersion.id,
          documentType: meta.data.documentType,
          fileSizeBytes: file.size,
          fileName,
        },
      })

      return { document, documentVersion }
    })

    return Response.json(
      {
        documentId: result.document.id,
        documentVersionId: result.documentVersion.id,
        status: result.documentVersion.status,
        name: result.document.name,
        documentType: result.document.documentType,
      },
      { status: 202 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
