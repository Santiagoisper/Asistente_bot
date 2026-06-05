import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

/** PRD section 7.2: PDF, max 50MB, closed document types. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024

const uploadMeta = z.object({
  studyId: z.string().uuid(),
  name: z.string().min(1),
  documentType: z.enum([
    'protocol',
    'investigator_brochure',
    'lab_manual',
    'pharmacy_manual',
    'other',
  ]),
})

/**
 * POST /api/documents/upload - upload a PDF and enqueue ingestion.
 *
 * Functional stub: validates auth + study access + file and returns a pending
 * document id.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const form = await req.formData()
    const file = form.get('file')
    const meta = uploadMeta.safeParse({
      studyId: form.get('studyId'),
      name: form.get('name'),
      documentType: form.get('documentType'),
    })

    if (!meta.success || !(file instanceof File)) {
      return new Response('Bad Request', { status: 400 })
    }
    if (file.type !== 'application/pdf' || file.size > MAX_PDF_BYTES) {
      return new Response('Unsupported Media Type', { status: 415 })
    }

    const { orgId, study } = await validateStudyAccess(meta.data.studyId)
    void orgId
    void study
    void file

    // TODO(paso-4): put() to Vercel Blob with an unguessable key, create
    // document + document_version(pending), enqueue ingestion, audit upload.
    const documentId = crypto.randomUUID()

    return Response.json({ documentId, status: 'pending' as const }, { status: 202 })
  } catch (err) {
    return handleApiError(err)
  }
}
