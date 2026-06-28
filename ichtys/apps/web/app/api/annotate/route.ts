import { z } from 'zod'
import { auth } from '@clerk/nextjs/server'
import { handleApiError } from '@ichtys/auth'
import { annotateAnswerSync } from '@ichtys/rag/medical-annotator'

/**
 * GET /api/annotate?text=...
 *
 * Thin wrapper sobre annotateAnswerSync (< 1 ms, sin I/O).
 * Usado por spec-review.tsx para re-computar chips SNOMED/LOINC
 * inmediatamente después de editar un criterio de elegibilidad,
 * sin necesidad de recargar la página.
 *
 * Auth: requiere sesión activa de Clerk. El endpoint no expone datos
 * del estudio — solo ejecuta el diccionario local sobre texto provisto.
 */

export const runtime = 'nodejs'

const querySchema = z.object({
  text: z.string().min(1).max(5000),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) return new Response('Unauthorized', { status: 401 })
  } catch (err) {
    return handleApiError(err)
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({ text: url.searchParams.get('text') })

  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  const annotations = annotateAnswerSync(parsed.data.text)

  return Response.json({ annotations })
}
