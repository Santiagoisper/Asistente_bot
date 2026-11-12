/**
 * Aviso de protocolo sin aprobar (docs/compliance/REGULATORY-BASELINE.md, C5).
 *
 * La evaluación de elegibilidad y el asistente trabajan con el último
 * protocolo que extrajo la IA, lo haya aprobado alguien o no. Mientras eso sea
 * así, la pantalla tiene que decirlo: un resultado que sale de un borrador sin
 * revisar no puede leerse como si saliera de uno aprobado (R6).
 *
 * Decisión de Santiago del 2026-11-12: avisar ahora; exigir la aprobación
 * cuando exista la pantalla de equipo, para no frenar estudios que hoy solo
 * tienen borrador.
 */

/** Cualquier estado que no sea exactamente `approved` cuenta como sin aprobar. */
export function isUnapprovedSpec(status: string | null | undefined): boolean {
  return status !== 'approved'
}

/** Texto para la pantalla de elegibilidad. `null` cuando el protocolo está aprobado. */
export function unapprovedSpecNotice(
  status: string | null | undefined,
  version: number | null | undefined,
): string | null {
  if (!isUnapprovedSpec(status)) return null
  const which = typeof version === 'number' ? ` (versión ${version})` : ''
  return (
    `Esta evaluación usa criterios que la IA extrajo del protocolo y que nadie aprobó todavía${which}. ` +
    'Revisá y aprobá el protocolo extraído antes de apoyarte en este resultado.'
  )
}

/** Marca que lleva la cita del asistente cuando el protocolo extraído no está aprobado. */
export const UNAPPROVED_SPEC_TITLE_SUFFIX = ' · BORRADOR SIN APROBAR'

/** Primera línea del contenido que recibe el modelo, para que lo diga en la respuesta. */
export const UNAPPROVED_SPEC_CONTENT_NOTE =
  'NOTA: este resumen sale de un borrador extraído por IA que ninguna persona aprobó todavía. ' +
  'Si la respuesta se apoya en él, decilo.'
