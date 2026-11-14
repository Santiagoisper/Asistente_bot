import { capabilitiesOf, hasFullStudyScope } from '@ichtys/auth/functions'
import { canAccessPhiData } from '@ichtys/auth/roles'
import { membershipStillUsable } from '@ichtys/auth/study-membership'
import type { OrgMember } from './org-members'
import { ACCESS_OPEN_DEFAULT_DAYS } from './permissions'
import type { TeamSnapshot } from './team-service'

/**
 * Reglas del modo de acceso de la organización
 * (docs/decisions/study-membership.md, M5/M8 y la sección «Cambio de modo»).
 *
 * Desde M20 el modo efectivo es el de la columna: el plazo vencido ya no
 * convierte `open` en `enforced` (ver packages/auth/access-subject.ts). Lo
 * único que el plazo sigue decidiendo es la vuelta: desde `enforced`, pasado
 * el plazo, no se vuelve a `open` (M5).
 *
 * `ACCESS_OPEN_DEFAULT_DAYS` (M8) vive en permissions.ts: la pantalla lo cita
 * en sus textos (L6) y este archivo no puede importarse del lado cliente.
 */

export { ACCESS_OPEN_DEFAULT_DAYS }

export type ModeChangeProblem = 'deadline_passed' | 'no_change'

/**
 * Puede cambiar de modo salvo por dos cosas: volver a `open` con el plazo
 * vencido (queda para siempre, paso 4 de la sección de cambio de modo) y
 * pedir el modo que ya rige (sin efecto, se registra igual que los no-cambios
 * de funciones y membresías).
 */
export function canSwitchMode(params: {
  target: 'open' | 'enforced'
  effectiveMode: 'open' | 'enforced'
  openUntil: Date | null
  now: Date
}): ModeChangeProblem | null {
  if (params.target === params.effectiveMode) return 'no_change'
  if (params.target === 'open') {
    const expired = params.openUntil !== null && params.openUntil.getTime() <= params.now.getTime()
    if (expired) return 'deadline_passed'
  }
  return null
}

export interface ModeImpactPerson {
  userId: string
  name: string | null
  /** Estudios que hoy ve por el modo abierto y dejaría de ver en estricto. */
  losesStudies: Array<{ studyId: string; studyName: string }>
  /** En estricto no entra a ningún estudio de la organización. */
  losesAllStudies: boolean
  /** Hoy puede evolucionar por su rol y no tiene la función Investigador/a (M15). */
  stopsAuthoring: boolean
}

/**
 * Qué cambia si la organización pasa a modo estricto: para cada persona, los
 * estudios que deja de ver, si queda sin ninguno y si deja de poder evolucionar
 * (paso 3 de la sección de cambio de modo). La lista la arma la pantalla antes
 * de pedir confirmación.
 *
 * En estricto una persona ve: todos los estudios si alguna de sus funciones
 * tiene alcance total (M10); si no, los de sus membresías vigentes, siempre
 * que conserve `study.read`. Es la misma regla que `loadStudyScope`.
 */
export function previewEnforcedImpact(params: {
  members: OrgMember[]
  snapshot: TeamSnapshot
  now: Date
}): ModeImpactPerson[] {
  const { members, snapshot, now } = params

  return members.map((member) => {
    const functions = snapshot.functions.filter((row) => row.userId === member.userId).map((row) => row.functionKey)
    const capabilities = capabilitiesOf(functions)

    let visibleIds: ReadonlySet<string>
    if (hasFullStudyScope(functions)) {
      visibleIds = new Set(snapshot.studies.map((study) => study.id))
    } else if (!capabilities.has('study.read')) {
      visibleIds = new Set()
    } else {
      // Misma regla que loadStudyScope, incluida M18: para el monitor, una
      // membresía sin fecha ya venció.
      const isMonitor = functions.includes('monitor')
      visibleIds = new Set(
        snapshot.memberships
          .filter(
            (row) => row.userId === member.userId && membershipStillUsable(isMonitor, row.expiresAt, now),
          )
          .map((row) => row.studyId),
      )
    }

    const losesStudies = snapshot.studies
      .filter((study) => !visibleIds.has(study.id))
      .map((study) => ({ studyId: study.id, studyName: study.name }))

    return {
      userId: member.userId,
      name: member.name,
      losesStudies,
      losesAllStudies: snapshot.studies.length > 0 && visibleIds.size === 0,
      stopsAuthoring: canAccessPhiData(member.role) && !functions.includes('investigator'),
    }
  })
}
