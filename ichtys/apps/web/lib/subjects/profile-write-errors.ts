import { ProfileInvalidError, ProfileUnreadableError } from './patient-profile-service'
import type { ProfileWriteErrorCode } from './profile-write-messages'

/**
 * Respuesta con código propio para los dos errores de la guarda de escritura del perfil.
 * 422 y no 409: las pantallas leen un 409 como «otra persona ya lo resolvió» y recargan
 * sin decir nada. El cuerpo lleva solo el código, ningún dato del perfil.
 */
export function profileWriteErrorResponse(err: unknown): Response | null {
  const code: ProfileWriteErrorCode | null =
    err instanceof ProfileUnreadableError ? 'profile_unreadable' : err instanceof ProfileInvalidError ? 'profile_invalid' : null
  return code ? Response.json({ error: code }, { status: 422 }) : null
}
