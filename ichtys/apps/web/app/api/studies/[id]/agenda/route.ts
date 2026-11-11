import { validatePhiStudyAccess, handleApiError } from '@ichtys/auth'
import { createAgendaItemSchema } from '../../../../../lib/agenda/agenda-schema'
import { AgendaError, createAgendaItem } from '../../../../../lib/agenda/agenda-service'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../lib/api/body-limit'
import { writeAuditLog } from '../../../../../lib/chat/persistence'
import { isOsEnabled } from '../../../../../lib/flags'
import { loadOrgTimeZone } from '../../../../../lib/os/org-settings'
import { PhiConfigError } from '../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/**
 * POST — agenda un turno en un estudio. La organización sale del token; el
 * estudio, de la URL; el sujeto (si hay) tiene que ser de ese estudio.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: studyId } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  let access: Awaited<ReturnType<typeof validatePhiStudyAccess>>
  try {
    access = await validatePhiStudyAccess(studyId)
  } catch (err) {
    return handleApiError(err)
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) return new Response('Payload Too Large', { status: 413 })
    return new Response('Bad Request', { status: 400 })
  }
  const parsed = createAgendaItemSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'invalid_item' }, { status: 400 })

  try {
    const created = await createAgendaItem({ orgId: access.orgId, studyId: access.study.id, userId: access.userId, timeZone: await loadOrgTimeZone(access.orgId), input: parsed.data })
    await writeAuditLog({
      action: 'agenda.create',
      orgId: access.orgId,
      studyId: access.study.id,
      userId: access.userId,
      resourceType: 'agenda_item',
      resourceId: created.id,
      // Sin título ni notas: pueden traer texto libre.
      metadata: { kind: parsed.data.kind, day: parsed.data.day, hasSubject: parsed.data.subjectId !== null },
    })
    return Response.json(created, { status: 201 })
  } catch (err) {
    if (err instanceof AgendaError) return Response.json({ error: err.code }, { status: err.code === 'subject_mismatch' ? 400 : 404 })
    if (err instanceof PhiConfigError) return new Response('Service Unavailable', { status: 503 })
    return handleApiError(err)
  }
}
