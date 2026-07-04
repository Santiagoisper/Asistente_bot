import { validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

/**
 * GET /api/chat/warmup?studyId= — calienta auth + DB sin llamar al LLM.
 * Evita cold-start en la primera pregunta real del chat.
 */
export async function GET(req: Request): Promise<Response> {
  const studyId = new URL(req.url).searchParams.get('studyId')
  if (!studyId) {
    return Response.json({ error: 'studyId required' }, { status: 400 })
  }

  try {
    await validateStudyAccess(studyId)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
