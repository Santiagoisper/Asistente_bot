import type { LabObservation } from './profile-schema'

/**
 * De dónde salió un valor de laboratorio, en los caminos que confirman valores a mano
 * (docs/decisions/huella-y-procedencia-de-archivos.md, D1). El origen lo pone el camino, no
 * quien manda los datos: un valor que llega con un origen ajeno lo pierde y recibe el del
 * camino por el que entró. La fecha de la muestra también la pone el camino: solo un informe
 * confirmado la aporta (D2 y D3), y un valor que llega con una fecha ajena la pierde.
 */
type IncomingLab = Pick<LabObservation, 'name' | 'value'> & Partial<LabObservation>

/** El valor sin ningún origen que traiga de antes. */
function withoutOrigin(lab: IncomingLab): Omit<IncomingLab, 'source' | 'sourceEvolutionId' | 'sampleDate'> {
  const { source: _source, sourceEvolutionId: _sourceEvolutionId, sampleDate: _sampleDate, ...rest } = lab
  return rest
}

/**
 * Valores de un informe de laboratorio que una persona confirmó. `sampleDate` es la fecha de la
 * muestra que esa persona confirmó para el informe entero (D4), o `null` si la dejó como
 * desconocida: nunca la fecha de carga ni la de emisión (D2). Sin ese argumento no se escribe.
 */
export function labsFromLabReport(labs: readonly IncomingLab[], reportId: string, sampleDate?: string | null): LabObservation[] {
  return labs.map((lab) => ({
    ...withoutOrigin(lab),
    source: { kind: 'lab_report', reportId },
    ...(sampleDate === undefined ? {} : { sampleDate }),
  }))
}

/**
 * Valores de un texto pegado que una persona revisó. De lo que llega se toman solo el nombre,
 * el valor y la unidad: el rango de referencia y la fecha de la muestra llegan únicamente de
 * un informe confirmado (el rango decide criterios como el de las transaminasas), y un texto
 * pegado no puede aportarlos aunque el pedido los traiga.
 */
export function labsFromPastedText(labs: readonly IncomingLab[]): LabObservation[] {
  return labs.map((lab) => ({
    name: lab.name,
    value: lab.value,
    ...(lab.unit ? { unit: lab.unit } : {}),
    source: { kind: 'pasted_text' },
  }))
}

/**
 * Un valor que sale de una evolución. Lleva el origen en la forma nueva y conserva
 * `sourceEvolutionId`: un código anterior a C4 sigue leyendo de ahí.
 */
export function labFromEvolution(lab: IncomingLab, evolutionId: string): LabObservation {
  return { ...withoutOrigin(lab), sourceEvolutionId: evolutionId, source: { kind: 'evolution', evolutionId } }
}
