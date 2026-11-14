/**
 * Lo que la pantalla le dice a la persona cuando el perfil de un sujeto no se pudo leer o
 * un cambio no se pudo guardar. Sin dependencias: lo importan componentes de cliente.
 */
export type ProfileWriteErrorCode = 'profile_unreadable' | 'profile_invalid'

const MESSAGES: Record<ProfileWriteErrorCode, string> = {
  profile_unreadable:
    'El perfil guardado de este sujeto no se pudo leer. No se cambió nada y los datos siguen guardados. Avisá a quien administra la plataforma.',
  profile_invalid: 'El cambio dejaba el perfil con un dato que no es válido, así que no se guardó. El perfil quedó como estaba.',
}

/** Mensaje propio para el código que devolvió la ruta, o `null` si el código es otro. */
export function profileWriteErrorMessage(code: unknown): string | null {
  return typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? MESSAGES[code as ProfileWriteErrorCode] : null
}

/** El aviso fijo de la ficha cuando lo guardado no se pudo leer. */
export const PROFILE_UNREADABLE_NOTICE = {
  title: 'El perfil guardado de este sujeto no se pudo leer',
  body: [
    'Los datos no están borrados: siguen guardados y nada los va a pisar. Lo que ves vacío acá abajo está vacío porque no se pudo leer, no porque falte.',
    'No se evaluó la elegibilidad. Hasta que se repare no se pueden aceptar propuestas ni confirmar laboratorios de este sujeto; las evoluciones sí se guardan.',
    'Avisá a quien administra la plataforma.',
  ],
} as const
