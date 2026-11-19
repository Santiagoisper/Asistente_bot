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

/** La misma condición escrita de dos formas («DM2» y «diabetes tipo 2») se muestra una vez (recorrido 19/11, R-07). */
const CONDITION_SYNONYMS: Record<string, string> = {
  dm2: 'diabetes tipo 2',
  'dm 2': 'diabetes tipo 2',
  'diabetes mellitus tipo 2': 'diabetes tipo 2',
  dbt2: 'diabetes tipo 2',
  hta: 'hipertension arterial',
  'hipertension arterial': 'hipertension arterial',
}

function conditionKey(condition: string): string {
  const plain = condition.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return CONDITION_SYNONYMS[plain] ?? plain
}

export function uniqueConditions(conditions: readonly string[]): string[] {
  const seen = new Map<string, string>()
  for (const condition of conditions) {
    const key = conditionKey(condition)
    const kept = seen.get(key)
    // Se queda con la forma más larga: «diabetes tipo 2» antes que «DM2».
    if (kept === undefined || condition.length > kept.length) seen.set(key, condition)
  }
  return [...seen.values()]
}
