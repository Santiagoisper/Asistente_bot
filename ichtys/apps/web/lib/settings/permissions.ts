import { allows, type AccessSubject } from '@ichtys/auth/functions'
import { ROLES, roleSatisfies, type Role } from '@ichtys/auth/roles'

/** Comprobación histórica: administrador del estudio o de la organización. */
const couldChangeSettings = (role: Role): boolean => roleSatisfies(role, ROLES.STUDY_ADMIN)

/**
 * ¿Puede cambiar los ajustes de la organización? La usan la ruta y la pantalla:
 * si cada una decidiera por su cuenta, la pantalla mostraría controles que la
 * ruta rechaza, o los ocultaría a quien sí puede guardar.
 */
export function canChangeOrgSettings(access: AccessSubject): boolean {
  return allows(access, 'org.settings', couldChangeSettings)
}
