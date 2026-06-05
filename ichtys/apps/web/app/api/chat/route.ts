import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const chatInput = z
  .object({
    studyId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    message: z.string().min(1),
  })
  .strict()

/**
 * POST /api/chat - grounded answer engine, streaming.
 *
 * Required pattern: auth -> Zod -> validateStudyAccess -> business logic.
 * organization_id never comes from the body; validateStudyAccess resolves it
 * from the Clerk token.
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
    const { orgId, study } = await validateStudyAccess(parsed.data.studyId)
    void orgId
    void study

    // TODO(paso-7): replace with streamText() fed by generateAnswer(); persist
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
    return handleApiError(err)
  }
}
