/**
 * La presión arterial del perfil al sumar lo que trae una evolución. Es un par: sistólica y
 * diastólica medidas juntas.
 *
 * Antes cada número se tomaba por separado («el nuevo, o si no el anterior»). Una evolución que
 * traía solo la sistólica dejaba esa sistólica con la diastólica de otra evolución: un par que
 * nadie midió, con la etiqueta del par viejo (Architect, #175).
 *
 * Regla: el par nuevo entra solo si viene completo. Medio par no se guarda y no pisa nada.
 */
export interface StoredBloodPressure {
  systolic?: number
  diastolic?: number
  bloodPressureLabel?: string
}

/**
 * «Llegaron los dos.» Es la única condición que decide si la presión de una evolución entra al
 * perfil. La confianza de la presión usa la misma (`extract-merge.ts`), y lo que la propuesta le
 * dice a la persona se compara con esto en una prueba (`proposal-display.test.ts`).
 */
export function isBloodPressurePair(incoming: { systolic?: number; diastolic?: number }): incoming is { systolic: number; diastolic: number } {
  return incoming.systolic !== undefined && incoming.diastolic !== undefined
}

export function mergedBloodPressure(current: StoredBloodPressure | undefined, incoming: { systolic?: number; diastolic?: number }): StoredBloodPressure {
  if (isBloodPressurePair(incoming)) {
    return { systolic: incoming.systolic, diastolic: incoming.diastolic, bloodPressureLabel: `${incoming.systolic}/${incoming.diastolic}` }
  }
  const systolic = current?.systolic
  const diastolic = current?.diastolic
  // Con los dos números guardados, la etiqueta sale de ellos. Si lo guardado ya era medio par
  // (anterior a esta regla), se deja como está: no se inventa ni se borra.
  const bloodPressureLabel = systolic !== undefined && diastolic !== undefined ? `${systolic}/${diastolic}` : current?.bloodPressureLabel
  return { systolic, diastolic, bloodPressureLabel }
}
