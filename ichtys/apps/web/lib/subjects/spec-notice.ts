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
 *
 * Desde que existe la pantalla de equipo, la aprobación se exige: la
 * elegibilidad y el asistente leen solo el último protocolo **aprobado**. Lo
 * de abajo sobre «sin aprobar» queda como segunda barrera (si un borrador
 * llegara igual a la pantalla o a una cita, se marca) y para decir que hay
 * un borrador esperando.
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

/**
 * Línea fija que se agrega a la respuesta del asistente cuando cita un
 * protocolo extraído sin aprobar. La marca de la cita vive solo en la
 * respuesta en vivo (esas citas no se guardan); esta línea queda en el texto
 * guardado, así que el aviso sigue ahí al reabrir la conversación y no depende
 * de que el modelo lo repita.
 */
export const UNAPPROVED_SPEC_ANSWER_NOTICE =
  '> Aviso: esta respuesta se apoya en criterios que la IA extrajo del protocolo y que nadie aprobó todavía (borrador).'

/** Agrega el aviso al final de la respuesta si alguna de sus citas es de un borrador sin aprobar. */
export function withUnapprovedSpecNotice(
  answer: string,
  evidences: ReadonlyArray<{ chunkId: string; sectionTitle?: string | null }>,
): { answer: string; appended: string } {
  const citesDraft = evidences.some(
    (evidence) =>
      evidence.chunkId.startsWith('spec:') && (evidence.sectionTitle ?? '').endsWith(UNAPPROVED_SPEC_TITLE_SUFFIX),
  )
  if (!citesDraft || answer.trim().length === 0 || answer.includes(UNAPPROVED_SPEC_ANSWER_NOTICE)) {
    return { answer, appended: '' }
  }
  const appended = `\n\n${UNAPPROVED_SPEC_ANSWER_NOTICE}`
  return { answer: `${answer}${appended}`, appended }
}

// ─────────────────────────────────────────────────────────────────────────────
// La aprobación se exige (C5)
// ─────────────────────────────────────────────────────────────────────────────

interface SpecRowLike {
  version: number
  status: string
}

/**
 * ¿Hay un protocolo extraído esperando aprobación? `approved` es el último aprobado (o nada) y
 * `latest` el último extraído, aprobado o no. Sin aprobado, cualquier borrador cuenta; con
 * aprobado, solo un borrador de versión más nueva.
 */
export function pendingSpecApproval(
  approved: SpecRowLike | null | undefined,
  latest: SpecRowLike | null | undefined,
): { pending: boolean; version: number | null } {
  if (!latest || latest.status !== 'draft') return { pending: false, version: null }
  if (approved && latest.version <= approved.version) return { pending: false, version: null }
  return { pending: true, version: latest.version }
}

export const SPEC_PENDING_APPROVAL_MESSAGE =
  'El protocolo extraído por la IA todavía no fue aprobado. La elegibilidad no se evalúa hasta que una persona lo apruebe.'

/** Lo que dice la pantalla de elegibilidad cuando no hay protocolo aprobado y sí un borrador. */
export function specPendingApprovalNotice(version: number | null | undefined): string {
  const which = typeof version === 'number' ? ` (versión ${version})` : ''
  return (
    `La elegibilidad no se evalúa todavía: la IA extrajo el protocolo${which} y nadie lo aprobó. ` +
    'Revisalo y aprobalo en la pestaña Spec del estudio; lo aprueba quien administra el estudio.'
  )
}

/** Con protocolo aprobado y una versión más nueva sin aprobar. */
export function newerDraftNotice(approvedVersion: number | null | undefined, draftVersion: number | null | undefined): string {
  const used = typeof approvedVersion === 'number' ? `la versión ${approvedVersion}, aprobada` : 'la última versión aprobada'
  const draft = typeof draftVersion === 'number' ? ` (la ${draftVersion})` : ''
  return `Esta evaluación usa ${used}. Hay una versión más nueva${draft}, extraída y sin aprobar: no se usa hasta que alguien la apruebe.`
}
