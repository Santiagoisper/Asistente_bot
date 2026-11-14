import { AccessError, handleApiError } from '@ichtys/auth'
import { db, eq, organizations } from '@ichtys/db'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../lib/api/body-limit'
import { teamModeInput } from '../../../../../lib/api/input-schemas'
import { resolveOrgAccessContext } from '../../../../../lib/access/org-context'
import { listOrgMembers } from '../../../../../lib/access/org-members'
import { ACCESS_OPEN_DEFAULT_DAYS, canSwitchMode, previewEnforcedImpact } from '../../../../../lib/access/mode-rules'
import { canManageOrgAccess } from '../../../../../lib/access/permissions'
import { assignOpenDeadline, loadTeamSnapshot, setOrgAccessMode } from '../../../../../lib/access/team-service'
import { auditedWrite } from '../../../../../lib/audit/audited-write'

export const runtime = 'nodejs'

const DAY_MS = 24 * 60 * 60 * 1000

async function readBody(req: Request): Promise<{ raw?: unknown; error?: Response }> {
  try {
    return { raw: await readJsonBody(req) }
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) return { error: new Response('Payload Too Large', { status: 413 }) }
    return { error: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
}

/**
 * GET /api/org/team/mode — el modo de acceso, su plazo y qué cambia si la
 * organización pasa a estricto (docs/decisions/study-membership.md, cambio de
 * modo). Solo para quien administra accesos.
 *
 * M5/M8: la primera vez que la administración abre esta pantalla con la org en
 * `open` sin plazo, se lo asigna (ACCESS_OPEN_DEFAULT_DAYS) y queda auditado:
 * el plazo empieza a correr cuando existe la pantalla que lo administra.
 */
export async function GET(): Promise<Response> {
  try {
    const context = await resolveOrgAccessContext()
    if (!canManageOrgAccess(context.access)) throw new AccessError('Insufficient role', 403)

    let openUntil = context.accessOpenUntil
    if (context.accessColumnMode === 'open' && openUntil === null) {
      const until = new Date(Date.now() + ACCESS_OPEN_DEFAULT_DAYS * DAY_MS)
      const assigned = await auditedWrite(
        // La escritura vive en team-service: nunca pisa una fecha existente.
        (tx) => assignOpenDeadline(tx, { orgId: context.orgId, until }),
        () => ({
          action: 'org.access_mode.deadline_set',
          orgId: context.orgId,
          userId: context.userId,
          resourceType: 'organization',
          resourceId: context.orgId,
          metadata: { days: ACCESS_OPEN_DEFAULT_DAYS, openUntil: until.toISOString() },
        }),
      )
      if (assigned.assigned) {
        openUntil = until
      } else {
        // Carrera perdida: otra llamada lo fijó primero. Vale lo que quedó.
        const raced = await db.query.organizations.findFirst({
          where: eq(organizations.id, context.orgId),
          columns: { accessOpenUntil: true },
        })
        openUntil = raced?.accessOpenUntil ?? null
      }
    }

    let impact: ReturnType<typeof previewEnforcedImpact> | null = null
    if (context.access.mode === 'open') {
      const [{ members }, snapshot] = await Promise.all([
        listOrgMembers(context.clerkOrgId),
        loadTeamSnapshot(context.orgId),
      ])
      // Solo las personas a las que el cambio les quita algo: la lista que la
      // pantalla enseña antes de pedir confirmación.
      impact = previewEnforcedImpact({ members, snapshot, now: new Date() }).filter(
        (person) => person.losesStudies.length > 0 || person.stopsAuthoring,
      )
    }

    const daysLeft =
      openUntil !== null ? Math.ceil((openUntil.getTime() - Date.now()) / DAY_MS) : null

    return Response.json({
      mode: context.access.mode,
      columnMode: context.accessColumnMode,
      openUntil,
      daysLeft,
      impact,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

/**
 * PUT /api/org/team/mode — cambia el modo de acceso. `open → enforced` siempre
 * se puede (solo quita acceso); `enforced → open` solo antes del plazo (M5:
 * después, no; reabrir la organización es una exposición mayor que el error
 * que corrige). El cambio queda auditado junto con la escritura (regla 7, R3).
 */
export async function PUT(req: Request): Promise<Response> {
  try {
    const { raw, error } = await readBody(req)
    if (error) return error
    const parsed = teamModeInput.safeParse(raw)
    if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 })
    const input = parsed.data

    const context = await resolveOrgAccessContext()
    if (!canManageOrgAccess(context.access)) throw new AccessError('Insufficient role', 403)

    const problem = canSwitchMode({
      target: input.mode,
      effectiveMode: context.access.mode,
      openUntil: context.accessOpenUntil,
      now: new Date(),
    })
    if (problem === 'deadline_passed') return Response.json({ error: problem }, { status: 422 })

    const result = await auditedWrite(
      // Pedir el modo que ya rige no toca nada: changed:false y el intento igual queda registrado.
      (tx) => setOrgAccessMode(tx, { orgId: context.orgId, mode: input.mode }),
      (outcome) => ({
        action: 'org.access_mode.update',
        orgId: context.orgId,
        userId: context.userId,
        resourceType: 'organization',
        resourceId: context.orgId,
        metadata: {
          from: context.access.mode,
          to: input.mode,
          columnModeBefore: context.accessColumnMode,
          deadline: context.accessOpenUntil ? context.accessOpenUntil.toISOString() : null,
          changed: outcome.changed,
        },
      }),
    )

    return Response.json({ changed: result.changed, mode: input.mode })
  } catch (err) {
    return handleApiError(err)
  }
}
