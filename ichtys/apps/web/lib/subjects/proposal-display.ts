/**
 * Texto de la presión arterial en una propuesta pendiente (R6).
 *
 * La extracción puede devolver solo una de las dos cifras. La presión entra al
 * perfil solo como par completo (`mergedBloodPressure`, en `@ichtys/clinical`):
 * con una cifra sola, aceptar la propuesta no guarda la presión y la del perfil
 * no cambia. La persona tiene que ver lo que se leyó y qué pasa al aceptar: la
 * cifra sola se muestra, con el aviso de cuál falta y de que no se guarda.
 */
const HALF_PAIR_NOT_SAVED = 'al aceptar, la presión no se guarda'

export function bloodPressureProposalLabel(facts: { systolic?: number; diastolic?: number }): string | null {
  const { systolic, diastolic } = facts
  if (systolic !== undefined && diastolic !== undefined) return `Presión arterial: ${systolic}/${diastolic}`
  if (systolic !== undefined) return `Presión arterial sistólica: ${systolic}. No se leyó la diastólica: ${HALF_PAIR_NOT_SAVED}`
  if (diastolic !== undefined) return `Presión arterial diastólica: ${diastolic}. No se leyó la sistólica: ${HALF_PAIR_NOT_SAVED}`
  return null
}
