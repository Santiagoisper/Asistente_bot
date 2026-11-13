import { AccessError, handleApiError } from '@ichtys/auth'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../lib/api/body-limit'
import { teamFunctionInput } from '../../../../../lib/api/input-schemas'
import { resolveOrgAccessContext } from '../../../../../lib/access/org-context'
import { findOrgMember } from '../../../../../lib/access/org-members'
import { canManageOrgAccess } from '../../../../../lib/access/permissions'
import { grantFunction, revokeFunction } from '../../../../../lib/access/team-service'
import { auditedWrite } from '../../../../../lib/audit/audited-write'

export const runtime = 'nodejs'

async function parse(req: Request) {
  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) return { error: new Response('Payload Too Large', { status: 413 }) }
    return { error: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
  const parsed = teamFunctionInput.safeParse(raw)
  if (!parsed.success) return { error: Response.json({ error: 'invalid_input' }, { status: 400 }) }
  return { input: parsed.data }
}

/**
 * POST /api/org/team/functions — asigna una función a una persona del centro.
 * M13: asignársela a uno mismo se permite y queda marcado en el registro.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const context = await resolveOrgAccessContext()
    if (!canManageOrgAccess(context.access)) throw new AccessError('Insufficient role', 403)

    const { input, error } = await parse(req)
    if (!input) return error

    // Una función no se asigna a un identificador que no es de esta organización.
    const member = await findOrgMember(context.clerkOrgId, input.userId)
    if (!member) return Response.json({ error: 'not_a_member' }, { status: 404 })

    const selfAssigned = input.userId === context.userId
    const result = await auditedWrite(
      (tx) =>
        grantFunction(tx, {
          orgId: context.orgId,
          userId: input.userId,
          functionKey: input.functionKey,
          actorId: context.userId,
        }),
      (outcome) => ({
        action: 'access.function.grant',
        orgId: context.orgId,
        userId: context.userId,
        resourceType: 'member_function',
        metadata: {
          memberUserId: input.userId,
          functionKey: input.functionKey,
          selfAssigned,
          changed: outcome.changed,
          mode: context.access.mode,
        },
      }),
    )

    return Response.json({ changed: result.changed, selfAssigned }, { status: result.changed ? 201 : 200 })
  } catch (err) {
    return handleApiError(err)
  }
}

/**
 * DELETE /api/org/team/functions — da de baja una función. No borra la fila.
 * No exige que la persona siga en la organización: una baja tiene que poder
 * hacerse justamente cuando alguien se fue.
 */
export async function DELETE(req: Request): Promise<Response> {
  try {
    const context = await resolveOrgAccessContext()
    if (!canManageOrgAccess(context.access)) throw new AccessError('Insufficient role', 403)

    const { input, error } = await parse(req)
    if (!input) return error

    const result = await auditedWrite(
      (tx) =>
        revokeFunction(tx, {
          orgId: context.orgId,
          userId: input.userId,
          functionKey: input.functionKey,
          actorId: context.userId,
        }),
      (outcome) => ({
        action: 'access.function.revoke',
        orgId: context.orgId,
        userId: context.userId,
        resourceType: 'member_function',
        metadata: {
          memberUserId: input.userId,
          functionKey: input.functionKey,
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
