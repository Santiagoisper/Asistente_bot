/**
 * Lo que entró al perfil desde una evolución que después se anuló por haberse registrado en el
 * sujeto equivocado (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 2).
 *
 * Alphi no saca nada del perfil solo: avisa. Los laboratorios guardan de qué evolución vinieron
 * y se pueden nombrar. Las medicaciones y las condiciones no guardan origen: de esas solo se
 * sabe que se aceptó una propuesta de esa evolución, no cuáles quedaron, y el aviso lo dice.
 *
 * Sin dependencias en ejecución (solo un tipo): lo importan componentes de cliente.
 */
import type { LabObservation } from '@ichtys/clinical'

/** Del valor de laboratorio solo se mira el nombre y de dónde salió. */
type LabWithOrigin = Pick<LabObservation, 'name' | 'value' | 'source' | 'sourceEvolutionId'>

export interface VoidedOriginNotice {
  /** Laboratorios del perfil cuyo origen es una evolución anulada. Puede estar vacío. */
  labNames: string[]
  /** Las evoluciones anuladas de las que entró algo. */
  evolutionIds: string[]
}

function originOf(lab: LabWithOrigin): string | undefined {
  return lab.source?.kind === 'evolution' ? lab.source.evolutionId : lab.sourceEvolutionId
}

/**
 * `acceptedFrom`: evoluciones de las que el registro dice que se aceptó una propuesta. Las que
 * no están anuladas no cuentan. Devuelve `null` si de ninguna anulada entró nada.
 */
export function voidedOriginNotice(input: {
  labs: readonly LabWithOrigin[]
  voidedEvolutionIds: readonly string[]
  acceptedFrom: readonly string[]
}): VoidedOriginNotice | null {
  const voided = new Set(input.voidedEvolutionIds)
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
  for (const evolutionId of input.acceptedFrom) {
    if (voided.has(evolutionId)) note(evolutionId)
  }
  return evolutionIds.length === 0 ? null : { labNames, evolutionIds }
}

export const VOIDED_ORIGIN_TITLE = 'El perfil incluye datos aceptados desde una evolución registrada por error en este sujeto'

/** Cuando no se pudo consultar: no se afirma que no hay nada. */
export const VOIDED_ORIGIN_UNKNOWN =
  'No se pudo comprobar si el perfil incluye datos aceptados desde una evolución registrada por error en este sujeto. Volvé a cargar la página.'

/** El cuerpo del aviso. No promete una corrección que la pantalla todavía no ofrece. */
export function voidedOriginLines(notice: VoidedOriginNotice): string[] {
  return [
    ...(notice.labNames.length > 0 ? [`Laboratorios que vinieron de esa evolución: ${notice.labNames.join(', ')}.`] : []),
    'Las medicaciones y las condiciones no guardan de qué evolución vinieron: pueden incluir datos de esa evolución, y acá no se pueden listar.',
    'Alphi no saca estos datos solo. Mientras sigan en el perfil, la elegibilidad se calcula con ellos.',
  ]
}
