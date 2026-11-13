import { AccessError, handleApiError } from '@ichtys/auth'
import { suggestedFunctionsForLegacyRole } from '@ichtys/auth/functions'
import { resolveOrgAccessContext } from '../../../../lib/access/org-context'
import { listOrgMembers } from '../../../../lib/access/org-members'
import { canManageOrgAccess } from '../../../../lib/access/permissions'
import { loadTeamSnapshot } from '../../../../lib/access/team-service'

export const runtime = 'nodejs'

/**
 * GET /api/org/team — el equipo del centro: personas, funciones vigentes, a qué
 * estudios entra cada una y el modo de acceso (docs/decisions/study-membership.md,
 * paso 5). Solo para quien administra accesos: lista a todo el personal.
 */
export async function GET(): Promise<Response> {
  try {
    const context = await resolveOrgAccessContext()
    if (!canManageOrgAccess(context.access)) throw new AccessError('Insufficient role', 403)

    const [{ members, truncated }, snapshot] = await Promise.all([
      listOrgMembers(context.clerkOrgId),
      loadTeamSnapshot(context.orgId),
    ])

    const known = new Set(members.map((member) => member.userId))
    const authors = new Set(snapshot.evolutionAuthors)

    const people = members.map((member) => {
      const functions = snapshot.functions.filter((row) => row.userId === member.userId).map((row) => row.functionKey)
      return {
        userId: member.userId,
        name: member.name,
        identifier: member.identifier,
        role: member.role,
        functions,
        // Punto de partida, no la verdad del centro: no autoriza nada hasta que se asigne.
        suggestedFunctions: functions.length === 0 ? suggestedFunctionsForLegacyRole(member.role) : [],
        studies: snapshot.memberships
          .filter((row) => row.userId === member.userId)
          .map((row) => ({ studyId: row.studyId, studyLabel: row.studyLabel, expiresAt: row.expiresAt })),
        // M15: escribió evoluciones y no tiene la función que lo permite en modo estricto.
        authorsWithoutInvestigator: authors.has(member.userId) && !functions.includes('investigator'),
        isSelf: member.userId === context.userId,
      }
    })

    // Funciones o membresías de alguien que ya no está en la organización: a la vista, para darlas de baja.
    const orphanUserIds = [
      ...new Set(
        [...snapshot.functions, ...snapshot.memberships].map((row) => row.userId).filter((userId) => !known.has(userId)),
      ),
    ]

    return Response.json({
      mode: context.access.mode,
      openUntil: context.accessOpenUntil,
      people,
      studies: snapshot.studies,
      orphanUserIds,
      truncated,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
