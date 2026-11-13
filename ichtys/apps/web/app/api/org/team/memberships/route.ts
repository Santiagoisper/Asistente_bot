import { auth } from '@clerk/nextjs/server'
import { AccessError, handleApiError, validateStudyAccess } from '@ichtys/auth'
import { db } from '@ichtys/db'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../lib/api/body-limit'
import { teamMembershipInput, teamMembershipRevokeInput } from '../../../../../lib/api/input-schemas'
import { findOrgMember } from '../../../../../lib/access/org-members'
import { STUDY_ACCESS_LEGACY_ROLE, checkMembershipExpiry } from '../../../../../lib/access/permissions'
import { loadActiveFunctions, revokeMembership, upsertMembership } from '../../../../../lib/access/team-service'
import { auditedWrite } from '../../../../../lib/audit/audited-write'

export const runtime = 'nodejs'

async function readBody(req: Request): Promise<{ raw?: unknown; error?: Response }> {
  try {
    return { raw: await readJsonBody(req) }
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) return { error: new Response('Payload Too Large', { status: 413 }) }
    return { error: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
}

/**
 * Quién da acceso a un estudio (M11): Operaciones en todos; el Study Coordinator
 * en los suyos. `validateStudyAccess` ya exige las dos cosas: que quien llama
 * pueda entrar a ESE estudio y que tenga la capacidad (o, en modo `open`, el
 * rol histórico). Quien solo administra la plataforma no entra a estudios (M12).
 */
const authorize = (studyId: string) => validateStudyAccess(studyId, STUDY_ACCESS_LEGACY_ROLE, 'access.manage_study')

/** POST /api/org/team/memberships — suma a una persona a un estudio, o cambia su etiqueta o vencimiento. */
export async function POST(req: Request): Promise<Response> {
  try {
    const { raw, error } = await readBody(req)
    if (error) return error
    const parsed = teamMembershipInput.safeParse(raw)
    if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 })
    const input = parsed.data

    const context = await authorize(input.studyId)
    const { orgId: clerkOrgId } = await auth()
    if (!clerkOrgId) throw new AccessError('Unauthorized', 401)

    const member = await findOrgMember(clerkOrgId, input.userId)
    if (!member) return Response.json({ error: 'not_a_member' }, { status: 404 })

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    const targetFunctions = await loadActiveFunctions(db, { orgId: context.orgId, userId: input.userId })
    const problem = checkMembershipExpiry({ targetFunctions, expiresAt, now: new Date() })
    if (problem) return Response.json({ error: problem }, { status: 422 })

    const result = await auditedWrite(
      (tx) =>
        upsertMembership(tx, {
          orgId: context.orgId,
          studyId: context.study.id,
          userId: input.userId,
          studyLabel: input.studyLabel?.trim() || null,
          expiresAt,
          actorId: context.userId,
        }),
      (outcome) => ({
        action: outcome.outcome === 'granted' ? 'access.membership.grant' : 'access.membership.update',
        orgId: context.orgId,
        studyId: context.study.id,
        userId: context.userId,
        resourceType: 'study_membership',
        resourceId: context.study.id,
        metadata: {
          memberUserId: input.userId,
          selfAssigned: input.userId === context.userId,
          hasExpiry: expiresAt !== null,
          mode: context.access.mode,
        },
      }),
    )

    return Response.json({ outcome: result.outcome }, { status: result.outcome === 'granted' ? 201 : 200 })
  } catch (err) {
    return handleApiError(err)
  }
}

/** DELETE /api/org/team/memberships — saca a una persona de un estudio. No borra la fila. */
export async function DELETE(req: Request): Promise<Response> {
  try {
    const { raw, error } = await readBody(req)
    if (error) return error
    const parsed = teamMembershipRevokeInput.safeParse(raw)
    if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 })
    const input = parsed.data

    const context = await authorize(input.studyId)

    const result = await auditedWrite(
      (tx) =>
        revokeMembership(tx, {
          orgId: context.orgId,
          studyId: context.study.id,
          userId: input.userId,
          actorId: context.userId,
        }),
      (outcome) => ({
        action: 'access.membership.revoke',
        orgId: context.orgId,
        studyId: context.study.id,
        userId: context.userId,
        resourceType: 'study_membership',
        resourceId: context.study.id,
        metadata: {
          memberUserId: input.userId,
          selfRevoked: input.userId === context.userId,
          changed: outcome.changed,
          mode: context.access.mode,
        },
      }),
    )

    return Response.json({ changed: result.changed })
  } catch (err) {
    return handleApiError(err)
  }
}
