/**
 * Texto de la presión arterial en una propuesta pendiente (R6).
 *
 * La extracción puede devolver solo una de las dos cifras, y aceptar la
 * propuesta la suma al perfil igual. La persona tiene que ver exactamente lo
 * que está por aceptar: una cifra sola se muestra, con el aviso de cuál falta.
 */
export function bloodPressureProposalLabel(facts: { systolic?: number; diastolic?: number }): string | null {
  const { systolic, diastolic } = facts
  if (systolic !== undefined && diastolic !== undefined) return `Presión arterial: ${systolic}/${diastolic}`
  if (systolic !== undefined) return `Presión arterial sistólica: ${systolic} (no se leyó la diastólica)`
  if (diastolic !== undefined) return `Presión arterial diastólica: ${diastolic} (no se leyó la sistólica)`
  return null
}
