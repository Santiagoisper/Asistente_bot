import { validatePhiStudyAccess, handleApiError } from '@ichtys/auth'
import { updateAgendaItemSchema } from '../../../../../../lib/agenda/agenda-schema'
import { AgendaError, updateAgendaItem } from '../../../../../../lib/agenda/agenda-service'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../lib/api/body-limit'
import { writeAuditLog } from '../../../../../../lib/chat/persistence'
import { isOsEnabled } from '../../../../../../lib/flags'
import { loadOrgTimeZone } from '../../../../../../lib/os/org-settings'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PATCH — cambia el estado de un turno o lo reprograma. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }): Promise<Response> {
  const { id: studyId, itemId } = await params
  if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

  let access: Awaited<ReturnType<typeof validatePhiStudyAccess>>
  try {
    access = await validatePhiStudyAccess(studyId, { require: 'agenda.manage' })
  } catch (err) {
    return handleApiError(err)
  }
  if (!UUID.test(itemId)) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) return new Response('Payload Too Large', { status: 413 })
    return new Response('Bad Request', { status: 400 })
  }
  const parsed = updateAgendaItemSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'invalid_item' }, { status: 400 })

  try {
    const updated = await updateAgendaItem({ orgId: access.orgId, studyId: access.study.id, itemId, userId: access.userId, timeZone: await loadOrgTimeZone(access.orgId), patch: parsed.data })
    await writeAuditLog({
      action: 'agenda.update',
      orgId: access.orgId,
      studyId: access.study.id,
      userId: access.userId,
      resourceType: 'agenda_item',
      resourceId: updated.id,
      metadata: { status: updated.status, rescheduledTo: parsed.data.day ?? null },
    })
    return Response.json(updated)
  } catch (err) {
    if (err instanceof AgendaError) return Response.json({ error: err.code }, { status: 404 })
    return handleApiError(err)
  }
}
