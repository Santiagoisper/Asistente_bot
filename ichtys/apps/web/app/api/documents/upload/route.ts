import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

/** PRD §7.2: PDF, máx 50MB, tipos cerrados. */
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
 * POST /api/documents/upload — sube un PDF a Vercel Blob y registra una
 * document_version (status: pending), encolando el pipeline de ingestion.
 *
 * Stub funcional: valida auth + study access + el archivo, y devuelve
 * { documentId, status: 'pending' }.
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

    // TODO(paso-4): put() a Vercel Blob (key no adivinable) → crear document +
    // document_version(pending) → enqueue ingestion → audit document.upload.
    const documentId = crypto.randomUUID()

    return Response.json({ documentId, status: 'pending' as const }, { status: 202 })
  } catch (err) {
    if (err instanceof AccessError) {
      return new Response(err.message, { status: err.status })
    }
    console.error('upload route error', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
