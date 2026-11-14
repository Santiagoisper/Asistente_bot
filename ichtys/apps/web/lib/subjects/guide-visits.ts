import type { ProtocolVisit } from '@ichtys/clinical'
import type { StudySpec } from '@ichtys/ingestion/study-spec'

/**
 * Las visitas del cronograma del protocolo que viajan a la guía de dictado (D21): nombre,
 * etiqueta, procedimientos y páginas. Las ventanas y el día nominal no hacen falta ahí.
 */
export function guideVisits(spec: Pick<StudySpec, 'visits'>): ProtocolVisit[] {
  return spec.visits.map(({ name, label, procedures, sourcePages }) => ({ name, label, procedures, sourcePages }))
}
