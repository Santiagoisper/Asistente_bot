/**
 * Lo que la pantalla dice al declarar, desde la historia, que una evolución se registró en el
 * sujeto equivocado (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 1).
 * Sin dependencias: lo importan componentes de cliente.
 *
 * Regla de estos textos: «no se declaró nada» solo cuando la respuesta lo prueba. Si no hubo
 * respuesta o el servidor falló, no se sabe, y se dice que no se sabe.
 */

/** Lo que la ruta contesta cuando la declaración salió. Una versión anterior puede no traerlo. */
export interface VoidOutcome {
  withdrawnAudios?: number
  proposalRetired?: boolean
}

export function voidErrorMessage(status: number, code: string): string {
  if (code === 'subject_mismatch') {
    return 'El sujeto que confirmaste no coincide con el de esta evolución. No se declaró nada: recargá la página y revisá en qué sujeto estás.'
  }
  if (code === 'already_voided') return 'Esta evolución ya figuraba como registrada por error en este sujeto. No se cambió nada.'
  if (code === 'profile_unreadable') {
    return 'El perfil guardado de este sujeto no se pudo leer, y sin leerlo no se sabe si había una propuesta pendiente de esta evolución. No se declaró nada. Avisá a quien administra la plataforma.'
  }
  if (code === 'phi_encryption_not_configured') {
    return 'Esta instalación no tiene configurado el cifrado de datos clínicos. No se declaró nada. Avisá a quien administra la plataforma.'
  }
  if (status === 404) return 'No se encontró esa evolución en este sujeto. No se declaró nada: recargá la página.'
  if (status === 403) {
    return 'Declarar este error lo hace quien escribió la evolución o quien coordina el estudio. No se declaró nada: avisá a quien coordina el estudio.'
  }
  if (status === 429) return 'Demasiados pedidos seguidos. No se declaró nada. Esperá un momento y volvé a intentar.'
  if (status >= 400 && status < 500) return 'El pedido no se pudo procesar. No se declaró nada.'
  return 'No se pudo confirmar si quedó declarado. Mirá la historia: si la evolución no figura como registrada por error, volvé a intentar.'
}

export function voidDoneMessage(outcome: VoidOutcome): string {
  const parts = ['Quedó marcada como registrada por error en este sujeto.']
  const audios = typeof outcome.withdrawnAudios === 'number' ? outcome.withdrawnAudios : 0
  if (audios === 1) parts.push('Su grabación pasó a las grabaciones sin sujeto.')
  else if (audios > 1) parts.push(`Sus ${audios} grabaciones pasaron a las grabaciones sin sujeto.`)
  if (outcome.proposalRetired === true) parts.push('La propuesta pendiente para el perfil se retiró.')
  parts.push('El perfil no se corrigió solo: si de esa evolución ya se había aceptado algo, la ficha lo avisa para que lo revises.')
  return parts.join(' ')
}
