/**
 * Lo que entró al perfil desde una evolución que después se anuló por haberse registrado en el
 * sujeto equivocado (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 2).
 *
 * Alphi no saca nada del perfil solo: avisa. Los laboratorios guardan de qué evolución vinieron
 * y se pueden nombrar. La edad, la presión arterial, las medicaciones y las condiciones no
 * guardan origen: de esas solo se sabe que se aceptó una propuesta de esa evolución, no cuáles
 * quedaron, y el aviso lo dice. Aceptar una propuesta **pisa** la edad y la presión arterial
 * (`mergeProfileWithExtraction`): el valor anterior no queda en el perfil.
 *
 * Sin dependencias en ejecución (solo un tipo): lo importan componentes de cliente.
 */
import type { LabObservation } from '@ichtys/clinical'

/** Del valor de laboratorio solo se mira el nombre y de dónde salió. */
type LabWithOrigin = Pick<LabObservation, 'name' | 'value' | 'source' | 'sourceEvolutionId'>

/**
 * Desde cuándo cada cambio del perfil que sale de una evolución deja registro. Antes, una
 * evolución escribía el perfil sola y sin registro: de una anulada de esa época no se puede
 * saber si dejó medicaciones o condiciones (los laboratorios sí guardaban su origen).
 *
 * El cambio (C1, PR #117) entró a `main` el 12/11/2026 a las 15:12 UTC y se desplegó minutos
 * después. El corte va más tarde a propósito: avisar de más es mejor que callar.
 */
export const PROFILE_WRITES_LOGGED_SINCE = '2026-11-12T16:00:00.000Z'

export interface VoidedEvolutionRef {
  id: string
  /** Cuándo se guardó la evolución (no cuándo se anuló). */
  createdAt: string
}

export interface VoidedOriginNotice {
  /** Laboratorios del perfil cuyo origen es una evolución anulada. Puede estar vacío. */
  labNames: string[]
  /** Las evoluciones anuladas de las que entró, o pudo haber entrado, algo. */
  evolutionIds: string[]
  /** El registro dice que de alguna se aceptó una propuesta. */
  acceptedProposal: boolean
  /** Alguna es anterior al registro: lo que dejó no se puede comprobar. */
  beforeLogging: boolean
}

function originOf(lab: LabWithOrigin): string | undefined {
  return lab.source?.kind === 'evolution' ? lab.source.evolutionId : lab.sourceEvolutionId
}

/** Una fecha ilegible cuenta como anterior. */
function predatesLogging(createdAt: string): boolean {
  const at = Date.parse(createdAt)
  return Number.isNaN(at) || at < Date.parse(PROFILE_WRITES_LOGGED_SINCE)
}

/**
 * `acceptedFrom`: evoluciones de las que el registro dice que se aceptó una propuesta. Las que
 * no están anuladas no cuentan. Devuelve `null` si de ninguna anulada entró nada y ninguna es
 * anterior al registro.
 */
export function voidedOriginNotice(input: {
  labs: readonly LabWithOrigin[]
  voided: readonly VoidedEvolutionRef[]
  acceptedFrom: readonly string[]
}): VoidedOriginNotice | null {
  const voided = new Set(input.voided.map((evolution) => evolution.id))
  if (voided.size === 0) return null

  const labNames: string[] = []
  const evolutionIds: string[] = []
  const note = (evolutionId: string) => {
    if (!evolutionIds.includes(evolutionId)) evolutionIds.push(evolutionId)
  }
  for (const lab of input.labs) {
    const origin = originOf(lab)
    if (origin === undefined || !voided.has(origin)) continue
    if (!labNames.includes(lab.name)) labNames.push(lab.name)
    note(origin)
  }
  let acceptedProposal = false
  for (const evolutionId of input.acceptedFrom) {
    if (!voided.has(evolutionId)) continue
    acceptedProposal = true
    note(evolutionId)
  }
  let beforeLogging = false
  for (const evolution of input.voided) {
    if (!predatesLogging(evolution.createdAt)) continue
    beforeLogging = true
    note(evolution.id)
  }
  return evolutionIds.length === 0 ? null : { labNames, evolutionIds, acceptedProposal, beforeLogging }
}

export const VOIDED_ORIGIN_TITLE = 'El perfil incluye datos aceptados desde una evolución registrada por error en este sujeto'

export const VOIDED_ORIGIN_POSSIBLE_TITLE = 'El perfil puede incluir datos de una evolución registrada por error en este sujeto'

/** Afirma que entraron datos solo si hay con qué: un laboratorio de ese origen o el registro. */
export function voidedOriginTitle(notice: VoidedOriginNotice): string {
  return notice.labNames.length > 0 || notice.acceptedProposal ? VOIDED_ORIGIN_TITLE : VOIDED_ORIGIN_POSSIBLE_TITLE
}

/** Cuando no se pudo consultar: no se afirma que no hay nada. */
export const VOIDED_ORIGIN_UNKNOWN =
  'No se pudo comprobar si el perfil incluye datos aceptados desde una evolución registrada por error en este sujeto. Volvé a cargar la página.'

/** El cuerpo del aviso. No promete una corrección que la pantalla todavía no ofrece. */
export function voidedOriginLines(notice: VoidedOriginNotice): string[] {
  // Sin registro de aceptación y sin ser anterior al registro, igual se dice: hay laboratorios
  // de ese origen en el perfil, así que algo entró.
  const stated = notice.acceptedProposal || !notice.beforeLogging
  return [
    ...(notice.labNames.length > 0 ? [`Laboratorios que vinieron de esa evolución: ${notice.labNames.join(', ')}. El valor anterior de cada uno no quedó guardado.`] : []),
    ...(stated
      ? ['La edad, la presión arterial, las medicaciones y las condiciones no guardan de qué evolución vinieron: pueden ser de esa evolución, y acá no se puede saber cuáles. El valor anterior de la edad y de la presión arterial no quedó guardado.']
      : []),
    ...(notice.beforeLogging
      ? ['Hay una evolución anulada anterior a que el sistema registrara qué entraba al perfil: puede haber dejado edad, presión arterial, medicaciones o condiciones, y no se puede comprobar.']
      : []),
    'Alphi no saca estos datos solo. Mientras sigan en el perfil, la elegibilidad se calcula con ellos.',
    'Avisá a quien coordina el estudio.',
  ]
}
