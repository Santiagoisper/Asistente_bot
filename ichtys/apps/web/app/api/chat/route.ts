import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const chatInput = z.object({
  studyId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1),
})

/**
 * POST /api/chat — answer engine (grounded), streaming.
 *
 * Patrón obligatorio (CLAUDE.md): auth → Zod → validateStudyAccess → lógica.
 * organization_id NUNCA viene del body; sale del token vía validateStudyAccess.
 *
 * Stub funcional: valida y devuelve una respuesta en streaming de placeholder.
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
    const { orgId, study } = await validateStudyAccess(parsed.data.studyId)
    void orgId
    void study

    // TODO(paso-7): reemplazar por streamText() del Vercel AI SDK alimentado por
    // generateAnswer({ organizationId: orgId, studyId, question }); persistir
    // message + citations + audit (chat.question / chat.answer).
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('[stub] chat answer engine not implemented yet'))
        controller.close()
      },
    })

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err) {
    if (err instanceof AccessError) {
      // Mensaje genérico: no se filtran detalles internos al cliente.
      return new Response(err.message, { status: err.status })
    }
    console.error('chat route error', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
