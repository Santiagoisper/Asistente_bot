/**
 * Texto de la presión arterial en una propuesta pendiente (R6).
 *
 * La presión es un par: una cifra sola NO se guarda en el perfil al aceptar
 * (blood-pressure.ts, #193/#175). La persona tiene que ver exactamente lo que
 * está por aceptar, antes de aceptar: la cifra que se leyó se muestra con el
 * aviso de cuál falta y de que esa cifra sola no entra al perfil.
 */
export function bloodPressureProposalLabel(facts: { systolic?: number; diastolic?: number }): string | null {
  const { systolic, diastolic } = facts
  if (systolic !== undefined && diastolic !== undefined) return `Presión arterial: ${systolic}/${diastolic}`
  if (systolic !== undefined)
    return `Presión arterial sistólica: ${systolic} (no se leyó la diastólica; sin las dos cifras no se guarda)`
  if (diastolic !== undefined)
    return `Presión arterial diastólica: ${diastolic} (no se leyó la sistólica; sin las dos cifras no se guarda)`
  return null
}
