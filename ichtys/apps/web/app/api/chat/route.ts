import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const chatInput = z.object({
  studyId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1),
})

/**
 * POST /api/chat — answer engine (grounded).
 *
 * Patrón obligatorio (CLAUDE.md): auth → Zod → validateStudyAccess → lógica.
 * organization_id NUNCA viene del body; sale del token vía validateStudyAccess.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = chatInput.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    // Valida sesión, org activa y que el study pertenece a la org del token.
    const ctx = await validateStudyAccess(parsed.data.studyId)
    void ctx

    // TODO(paso-7): generateAnswer({ organizationId: ctx.organizationId, studyId,
    //   question }) → streamText con citas; persistir message + citations + audit.
    return new Response('Not Implemented', { status: 501 })
  } catch (err) {
    if (err instanceof AccessError) {
      // Mensaje genérico: no se filtran detalles internos al cliente.
      return new Response(err.message, { status: err.status })
    }
    console.error('chat route error', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
